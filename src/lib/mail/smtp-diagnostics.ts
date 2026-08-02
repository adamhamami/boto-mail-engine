import net from "node:net";
import tls from "node:tls";
import type { TLSSocket } from "node:tls";
import { sanitizeSmtpMessage } from "./providers";
import type { SmtpEncryption } from "./providers";

/**
 * Sonde SMTP bas niveau : TCP → bannière → EHLO → STARTTLS → certificat.
 *
 * Ne transmet JAMAIS d'identifiants et n'envoie JAMAIS de message : la sonde
 * termine par QUIT juste après la poignée de main. L'étape authentification
 * est réalisée séparément par nodemailer (`SMTPProvider.verifyConnection`),
 * qui conserve la validation stricte du certificat.
 */

export type SmtpProbeStage =
  | "tcp"
  | "greeting"
  | "ehlo"
  | "starttls"
  | "tls"
  | "quit";

export interface SmtpCertificateInfo {
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  expired: boolean;
  fingerprint256: string | null;
  serialNumber: string | null;
  altNames: string[];
}

export interface SmtpTlsInfo {
  negotiated: boolean;
  mode: "implicit" | "starttls" | "none";
  protocol: string | null;
  cipher: string | null;
  /** Chaîne validée face au magasin d'autorités de confiance Node. */
  authorized: boolean;
  authorizationError: string | null;
}

export interface SmtpProbeTimings {
  tcpMs: number | null;
  greetingMs: number | null;
  ehloMs: number | null;
  tlsHandshakeMs: number | null;
  totalMs: number;
}

export interface SmtpProbeError {
  stage: SmtpProbeStage;
  code: string;
  message: string;
}

export interface SmtpProbeResult {
  reachable: boolean;
  greeting: string | null;
  capabilities: string[];
  starttlsAdvertised: boolean;
  authMechanisms: string[];
  maxMessageBytes: number | null;
  tls: SmtpTlsInfo;
  certificate: SmtpCertificateInfo | null;
  timings: SmtpProbeTimings;
  errors: SmtpProbeError[];
}

export interface SmtpProbeOptions {
  host: string;
  port: number;
  encryption: SmtpEncryption;
  /** STARTTLS absent ⇒ erreur bloquante plutôt que simple avertissement. */
  requireTls?: boolean;
  /** Domaine annoncé dans EHLO — évite de divulguer le hostname machine. */
  ehloDomain?: string;
  timeoutMs?: number;
  /** Valeurs à masquer dans les messages d'erreur remontés. */
  redact?: Array<string | undefined>;
}

export const DEFAULT_SMTP_PROBE_TIMEOUT_MS = 8000;

interface SmtpReply {
  code: number;
  lines: string[];
}

interface Reader {
  buffer: string;
  wake: (() => void) | null;
  error: Error | null;
  closed: boolean;
}

/**
 * Lecteur de réponses. Volontairement sans `setEncoding` : l'encodage d'un
 * socket ne peut pas être réinitialisé avant une bascule STARTTLS, ce qui
 * corromprait la couche TLS.
 */
function attachReader(socket: net.Socket | TLSSocket): Reader {
  const reader: Reader = {
    buffer: "",
    wake: null,
    error: null,
    closed: false,
  };

  socket.on("data", (chunk: Buffer) => {
    reader.buffer += chunk.toString("utf8");
    reader.wake?.();
  });
  socket.on("error", (err: Error) => {
    reader.error = err;
    reader.wake?.();
  });
  socket.on("close", () => {
    reader.closed = true;
    reader.wake?.();
  });

  return reader;
}

/**
 * Extrait une réponse complète. Une ligne n'est retenue que si elle est
 * terminée par un saut de ligne et au format final `NNN ` (et non `NNN-`).
 */
export function tryParseReply(reader: Reader): SmtpReply | null {
  const parts = reader.buffer.replace(/\r\n/g, "\n").split("\n");
  const complete = parts.slice(0, -1);
  const remainder = parts[parts.length - 1] ?? "";

  for (let i = 0; i < complete.length; i += 1) {
    const match = /^(\d{3})(?:\s|$)/.exec(complete[i]);
    if (!match) continue;

    reader.buffer = [...complete.slice(i + 1), remainder].join("\n");
    return {
      code: Number(match[1]),
      lines: complete
        .slice(0, i + 1)
        .map((line) => line.trim())
        .filter(Boolean),
    };
  }

  return null;
}

async function readReply(reader: Reader, timeoutMs: number): Promise<SmtpReply> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const parsed = tryParseReply(reader);
    if (parsed) return parsed;
    if (reader.error) throw reader.error;
    if (reader.closed) {
      throw new Error("Connexion fermée par le serveur avant la réponse");
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Délai dépassé en attente d'une réponse (${timeoutMs}ms)`);
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        reader.wake = null;
        resolve();
      }, Math.min(remaining, 200));
      reader.wake = () => {
        clearTimeout(timer);
        reader.wake = null;
        resolve();
      };
    });
  }
}

function writeCommand(socket: net.Socket | TLSSocket, command: string): void {
  socket.write(`${command}\r\n`);
}

function connectTcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);

    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };

    socket.once("connect", () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("timeout", () =>
      fail(new Error(`Délai de connexion TCP dépassé (${timeoutMs}ms)`)),
    );
    socket.once("error", fail);
  });
}

function upgradeToTls(
  socket: net.Socket | null,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    /*
     * rejectUnauthorized:false uniquement pour la SONDE : on veut afficher
     * « certificat expiré / chaîne invalide » dans l'UI plutôt qu'échouer sur
     * une erreur opaque. Aucun identifiant ni contenu de message ne transite
     * sur ce socket ; le transport d'envoi (nodemailer) reste strict.
     */
    const tlsSocket = tls.connect({
      ...(socket ? { socket } : { host, port }),
      servername: host,
      rejectUnauthorized: false,
    });

    const timer = setTimeout(() => {
      tlsSocket.destroy();
      reject(new Error(`Délai de poignée de main TLS dépassé (${timeoutMs}ms)`));
    }, timeoutMs);

    tlsSocket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(tlsSocket);
    });
    tlsSocket.once("error", (err: Error) => {
      clearTimeout(timer);
      tlsSocket.destroy();
      reject(err);
    });
  });
}

function describeAuthorization(socket: TLSSocket): string | null {
  if (socket.authorized) return null;
  const error = socket.authorizationError;
  if (!error) return "Certificat non validé";
  return typeof error === "string" ? error : error.message;
}

function readTlsInfo(
  socket: TLSSocket,
  mode: "implicit" | "starttls",
): SmtpTlsInfo {
  return {
    negotiated: true,
    mode,
    protocol: socket.getProtocol(),
    cipher: socket.getCipher()?.name ?? null,
    authorized: socket.authorized,
    authorizationError: describeAuthorization(socket),
  };
}

/** Les champs X.509 peuvent être multivalués (plusieurs CN). */
function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseCertificate(socket: TLSSocket): SmtpCertificateInfo | null {
  const cert = socket.getPeerCertificate(false);
  if (!cert || Object.keys(cert).length === 0) return null;

  const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
  const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
  const validToOk = validTo !== null && !Number.isNaN(validTo.getTime());

  const daysRemaining = validToOk
    ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000)
    : null;

  return {
    subject: firstValue(cert.subject?.CN),
    issuer: firstValue(cert.issuer?.O) ?? firstValue(cert.issuer?.CN),
    validFrom:
      validFrom !== null && !Number.isNaN(validFrom.getTime())
        ? validFrom.toISOString()
        : null,
    validTo: validToOk ? validTo.toISOString() : null,
    daysRemaining,
    expired: daysRemaining !== null && daysRemaining < 0,
    fingerprint256: cert.fingerprint256 ?? null,
    serialNumber: cert.serialNumber ?? null,
    altNames: (cert.subjectaltname ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 10),
  };
}

/** Analyse les capacités EHLO (`250-STARTTLS`, `250-AUTH PLAIN LOGIN`, `250-SIZE n`). */
export function parseEhloCapabilities(lines: string[]): {
  capabilities: string[];
  starttlsAdvertised: boolean;
  authMechanisms: string[];
  maxMessageBytes: number | null;
} {
  const capabilities = lines
    .map((line) => line.replace(/^\d{3}[- ]?/, "").trim())
    .filter(Boolean)
    // La première ligne est la salutation du serveur, pas une capacité.
    .slice(1);

  let starttlsAdvertised = false;
  let authMechanisms: string[] = [];
  let maxMessageBytes: number | null = null;

  for (const capability of capabilities) {
    const upper = capability.toUpperCase();

    if (upper === "STARTTLS" || upper.startsWith("STARTTLS ")) {
      starttlsAdvertised = true;
    }
    if (upper.startsWith("AUTH")) {
      authMechanisms = capability
        .slice(4)
        .split(/[\s=]+/)
        .map((mechanism) => mechanism.trim().toUpperCase())
        .filter(Boolean);
    }
    if (upper.startsWith("SIZE")) {
      const size = Number(upper.slice(4).trim());
      if (Number.isFinite(size) && size > 0) maxMessageBytes = size;
    }
  }

  return { capabilities, starttlsAdvertised, authMechanisms, maxMessageBytes };
}

function toProbeError(
  stage: SmtpProbeStage,
  error: unknown,
  redact: Array<string | undefined>,
): SmtpProbeError {
  const code =
    (error as { code?: string } | null)?.code ??
    (error instanceof Error ? error.name : "UNKNOWN");
  const message =
    error instanceof Error ? error.message : "Erreur SMTP inconnue";

  return {
    stage,
    code: String(code),
    message: sanitizeSmtpMessage(message, redact),
  };
}

/**
 * Exécute la sonde complète. Ne lève jamais : les échecs sont décrits dans
 * `errors` afin que la page Santé SMTP reste affichable.
 */
export async function probeSmtpConnection(
  options: SmtpProbeOptions,
): Promise<SmtpProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SMTP_PROBE_TIMEOUT_MS;
  const redact = options.redact ?? [];
  const ehloDomain = options.ehloDomain?.trim() || "localhost";
  const startedAt = Date.now();

  const result: SmtpProbeResult = {
    reachable: false,
    greeting: null,
    capabilities: [],
    starttlsAdvertised: false,
    authMechanisms: [],
    maxMessageBytes: null,
    tls: {
      negotiated: false,
      mode: "none",
      protocol: null,
      cipher: null,
      authorized: false,
      authorizationError: null,
    },
    certificate: null,
    timings: {
      tcpMs: null,
      greetingMs: null,
      ehloMs: null,
      tlsHandshakeMs: null,
      totalMs: 0,
    },
    errors: [],
  };

  let rawSocket: net.Socket | null = null;
  let activeSocket: net.Socket | TLSSocket | null = null;

  try {
    const tcpStart = Date.now();

    if (options.encryption === "tls") {
      const tlsSocket = await upgradeToTls(
        null,
        options.host,
        options.port,
        timeoutMs,
      );
      result.timings.tcpMs = Date.now() - tcpStart;
      result.timings.tlsHandshakeMs = result.timings.tcpMs;
      result.reachable = true;
      result.tls = readTlsInfo(tlsSocket, "implicit");
      result.certificate = parseCertificate(tlsSocket);
      activeSocket = tlsSocket;
    } else {
      rawSocket = await connectTcp(options.host, options.port, timeoutMs);
      result.timings.tcpMs = Date.now() - tcpStart;
      result.reachable = true;
      activeSocket = rawSocket;
    }

    let reader = attachReader(activeSocket);

    const greetingStart = Date.now();
    const greeting = await readReply(reader, timeoutMs);
    result.timings.greetingMs = Date.now() - greetingStart;
    result.greeting = greeting.lines[0]?.slice(0, 200) ?? null;

    if (greeting.code !== 220) {
      result.errors.push({
        stage: "greeting",
        code: String(greeting.code),
        message: sanitizeSmtpMessage(
          greeting.lines.join(" ") || "Bannière SMTP inattendue",
          redact,
        ),
      });
      return result;
    }

    const ehloStart = Date.now();
    writeCommand(activeSocket, `EHLO ${ehloDomain}`);
    const ehlo = await readReply(reader, timeoutMs);
    result.timings.ehloMs = Date.now() - ehloStart;

    const parsed = parseEhloCapabilities(ehlo.lines);
    result.capabilities = parsed.capabilities;
    result.starttlsAdvertised = parsed.starttlsAdvertised;
    result.authMechanisms = parsed.authMechanisms;
    result.maxMessageBytes = parsed.maxMessageBytes;

    if (
      options.encryption === "starttls" &&
      rawSocket &&
      parsed.starttlsAdvertised
    ) {
      writeCommand(activeSocket, "STARTTLS");
      const starttls = await readReply(reader, timeoutMs);
      if (starttls.code !== 220) {
        result.errors.push({
          stage: "starttls",
          code: String(starttls.code),
          message: sanitizeSmtpMessage(starttls.lines.join(" "), redact),
        });
        return result;
      }

      // Les écouteurs doivent être retirés avant que TLS ne prenne le socket.
      rawSocket.removeAllListeners("data");
      rawSocket.removeAllListeners("error");
      rawSocket.removeAllListeners("close");
      rawSocket.removeAllListeners("timeout");

      const tlsStart = Date.now();
      const tlsSocket = await upgradeToTls(
        rawSocket,
        options.host,
        options.port,
        timeoutMs,
      );
      result.timings.tlsHandshakeMs = Date.now() - tlsStart;
      result.tls = readTlsInfo(tlsSocket, "starttls");
      result.certificate = parseCertificate(tlsSocket);

      activeSocket = tlsSocket;
      reader = attachReader(tlsSocket);

      // EHLO post-TLS : les mécanismes AUTH ne sont souvent annoncés qu'ici.
      writeCommand(activeSocket, `EHLO ${ehloDomain}`);
      const secureEhlo = await readReply(reader, timeoutMs);
      const secureParsed = parseEhloCapabilities(secureEhlo.lines);
      result.capabilities = secureParsed.capabilities;
      result.authMechanisms = secureParsed.authMechanisms;
      result.maxMessageBytes =
        secureParsed.maxMessageBytes ?? result.maxMessageBytes;
    } else if (options.encryption === "starttls" && !parsed.starttlsAdvertised) {
      result.errors.push({
        stage: "starttls",
        code: "STARTTLS_UNAVAILABLE",
        message: options.requireTls
          ? "Le serveur n'annonce pas STARTTLS alors que TLS est exigé : envoi refusé"
          : "Le serveur n'annonce pas STARTTLS — trafic en clair (toléré hors production)",
      });
    }

    try {
      writeCommand(activeSocket, "QUIT");
      await readReply(reader, 1000);
    } catch {
      // QUIT best-effort : sans impact sur le diagnostic.
    }
  } catch (error) {
    const stage: SmtpProbeStage = !result.reachable
      ? "tcp"
      : result.greeting === null
        ? "greeting"
        : result.tls.negotiated
          ? "tls"
          : "ehlo";
    result.errors.push(toProbeError(stage, error, redact));
  } finally {
    activeSocket?.destroy();
    rawSocket?.destroy();
    result.timings.totalMs = Date.now() - startedAt;
  }

  return result;
}
