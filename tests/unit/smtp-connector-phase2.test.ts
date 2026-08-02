import net from "node:net";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetEnvCache, TEST_ONLY_AUTH_SECRET } from "@/lib/config/env";
import {
  MAIL_CONNECTOR_PRESETS,
  maskSmtpHost,
  resolveMailConnectorConfig,
  sanitizeSmtpMessage,
} from "@/lib/mail/providers";
import {
  parseEhloCapabilities,
  probeSmtpConnection,
} from "@/lib/mail/smtp-diagnostics";
import {
  buildSigv4CanonicalRequest,
  buildSigv4Headers,
  fetchProviderQuota,
  toAmzDate,
} from "@/lib/mail/provider-quota";
import {
  evaluateSmtpHealthStatus,
  resetSmtpHealthCache,
} from "@/lib/mail/smtp-health";
import type { SmtpHealthReport } from "@/lib/mail/smtp-health";
import { getMailProvider, resetMailProvider } from "@/lib/mail";

const ENV_SNAPSHOT = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>): void {
  process.env = {
    ...ENV_SNAPSHOT,
    NODE_ENV: "test",
    AUTH_SECRET: TEST_ONLY_AUTH_SECRET,
    ...overrides,
  } as NodeJS.ProcessEnv;

  // Les presets lisent process.env pour distinguer une valeur explicite.
  for (const key of [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_HOST_ALLOWLIST",
    "SMTP_REQUIRE_TLS",
  ]) {
    if (overrides[key] === undefined) delete process.env[key];
  }

  resetEnvCache();
  resetMailProvider();
  resetSmtpHealthCache();
}

afterEach(() => {
  process.env = { ...ENV_SNAPSHOT };
  resetEnvCache();
  resetMailProvider();
  resetSmtpHealthCache();
});

describe("Phase 2 — presets de connecteurs", () => {
  it("résout Brevo sur son relais SMTP en STARTTLS", () => {
    setEnv({ MAIL_PROVIDER: "brevo" });
    const config = resolveMailConnectorConfig();

    expect(config.connectorId).toBe("brevo");
    expect(config.host).toBe("smtp-relay.brevo.com");
    expect(config.port).toBe(587);
    expect(config.encryption).toBe("starttls");
    expect(config.secure).toBe(false);
    expect(config.hostSource).toBe("preset");
  });

  it("couvre les cinq connecteurs demandés", () => {
    const expected: Array<[string, string]> = [
      ["brevo", "smtp-relay.brevo.com"],
      ["mailgun", "smtp.mailgun.org"],
      ["postmark", "smtp.postmarkapp.com"],
      ["sendgrid", "smtp.sendgrid.net"],
    ];

    for (const [id, host] of expected) {
      setEnv({ MAIL_PROVIDER: id });
      expect(resolveMailConnectorConfig().host).toBe(host);
    }

    setEnv({ MAIL_PROVIDER: "ses", SES_REGION: "eu-central-1" });
    expect(resolveMailConnectorConfig().host).toBe(
      "email-smtp.eu-central-1.amazonaws.com",
    );

    setEnv({ MAIL_PROVIDER: "smtp", SMTP_HOST: "mail.interne.local" });
    expect(resolveMailConnectorConfig().host).toBe("mail.interne.local");
  });

  it("laisse une variable explicite surcharger le preset", () => {
    setEnv({
      MAIL_PROVIDER: "mailgun",
      SMTP_HOST: "smtp.eu.mailgun.org",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
    });
    const config = resolveMailConnectorConfig();

    expect(config.host).toBe("smtp.eu.mailgun.org");
    expect(config.port).toBe(465);
    expect(config.encryption).toBe("tls");
    expect(config.hostSource).toBe("env");
  });

  it("applique l'allowlist SSRF à l'hôte résolu du preset", () => {
    setEnv({
      MAIL_PROVIDER: "brevo",
      SMTP_HOST_ALLOWLIST: "smtp.autre.example",
    });
    expect(() => resolveMailConnectorConfig()).toThrow(/SMTP_HOST_ALLOWLIST/);

    setEnv({
      MAIL_PROVIDER: "brevo",
      SMTP_HOST_ALLOWLIST: "smtp-relay.brevo.com",
    });
    expect(resolveMailConnectorConfig().host).toBe("smtp-relay.brevo.com");
  });

  it("impose TLS pour les relais publics et suit le flag pour le SMTP classique", () => {
    setEnv({ MAIL_PROVIDER: "postmark", SMTP_REQUIRE_TLS: "false" });
    expect(resolveMailConnectorConfig().requireTls).toBe(true);

    setEnv({ MAIL_PROVIDER: "smtp", SMTP_HOST: "localhost" });
    expect(resolveMailConnectorConfig().requireTls).toBe(false);

    setEnv({ MAIL_PROVIDER: "smtp", SMTP_REQUIRE_TLS: "true" });
    expect(resolveMailConnectorConfig().requireTls).toBe(true);
  });

  it("nomme le provider d'après le connecteur actif", () => {
    setEnv({ MAIL_PROVIDER: "postmark" });
    expect(getMailProvider().name).toBe("postmark");
  });

  it("documente chaque preset sans exposer d'identifiant", () => {
    for (const preset of Object.values(MAIL_CONNECTOR_PRESETS)) {
      expect(preset.docsUrl).toMatch(/^https:\/\//);
      expect(preset.userHint.length).toBeGreaterThan(0);
    }
  });
});

describe("Phase 2 — masquage et expurgation", () => {
  it("masque l'hôte tout en gardant le domaine identifiable", () => {
    expect(maskSmtpHost("smtp-relay.brevo.com")).toBe("sm***.brevo.com");
    expect(maskSmtpHost("smtp.mailgun.org")).toBe("sm***.mailgun.org");
    expect(maskSmtpHost("localhost")).toBe("lo***");
    expect(maskSmtpHost("127.0.0.1")).toBe("127.***.***.1");
  });

  it("retire les identifiants des messages serveur", () => {
    const message = sanitizeSmtpMessage(
      "535 Authentication failed for agent@botoschool.com with pass s3cr3t-value",
      ["agent@botoschool.com", "s3cr3t-value"],
    );

    expect(message).not.toContain("agent@botoschool.com");
    expect(message).not.toContain("s3cr3t-value");
    expect(message).toContain("[redacted]");
  });
});

describe("Phase 2 — analyse des capacités EHLO", () => {
  it("détecte STARTTLS, AUTH et SIZE", () => {
    const parsed = parseEhloCapabilities([
      "250-smtp.example.com Hello",
      "250-SIZE 35882577",
      "250-STARTTLS",
      "250 AUTH LOGIN PLAIN",
    ]);

    expect(parsed.starttlsAdvertised).toBe(true);
    expect(parsed.authMechanisms).toEqual(["LOGIN", "PLAIN"]);
    expect(parsed.maxMessageBytes).toBe(35882577);
  });

  it("gère la syntaxe AUTH= héritée", () => {
    const parsed = parseEhloCapabilities([
      "250-smtp.example.com Hello",
      "250 AUTH=CRAM-MD5 PLAIN",
    ]);
    expect(parsed.authMechanisms).toEqual(["CRAM-MD5", "PLAIN"]);
  });

  it("n'annonce pas STARTTLS quand le serveur l'omet", () => {
    const parsed = parseEhloCapabilities([
      "250-mailpit Hello",
      "250 SIZE 10240000",
    ]);
    expect(parsed.starttlsAdvertised).toBe(false);
  });
});

/** Serveur SMTP factice : enregistre les commandes, ne transporte aucun mail. */
async function startFakeSmtp(options: {
  greeting?: string;
  advertiseStarttls?: boolean;
}): Promise<{
  port: number;
  commands: string[];
  close: () => Promise<void>;
}> {
  const commands: string[] = [];

  const server = net.createServer((socket) => {
    socket.write(`${options.greeting ?? "220 fake.smtp.test ESMTP"}\r\n`);
    socket.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\r\n").filter(Boolean)) {
        commands.push(line);
        const verb = line.split(" ")[0].toUpperCase();

        if (verb === "EHLO") {
          const lines = ["250-fake.smtp.test", "250-SIZE 10240000"];
          if (options.advertiseStarttls) lines.push("250-STARTTLS");
          lines.push("250 AUTH LOGIN PLAIN");
          socket.write(`${lines.join("\r\n")}\r\n`);
        } else if (verb === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("502 Command not implemented\r\n");
        }
      }
    });
    socket.on("error", () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;

  return {
    port: address.port,
    commands,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe("Phase 2 — sonde SMTP", () => {
  it("mesure la connexion et lit les capacités sans envoyer d'email", async () => {
    const server = await startFakeSmtp({ advertiseStarttls: false });

    try {
      const probe = await probeSmtpConnection({
        host: "127.0.0.1",
        port: server.port,
        encryption: "none",
        ehloDomain: "botoschool.com",
        timeoutMs: 3000,
      });

      expect(probe.reachable).toBe(true);
      expect(probe.greeting).toContain("220");
      expect(probe.authMechanisms).toEqual(["LOGIN", "PLAIN"]);
      expect(probe.maxMessageBytes).toBe(10240000);
      expect(probe.timings.tcpMs).not.toBeNull();
      expect(probe.timings.totalMs).toBeGreaterThanOrEqual(0);

      const verbs = server.commands.map((c) => c.split(" ")[0].toUpperCase());
      expect(verbs).toContain("EHLO");
      expect(verbs).not.toContain("MAIL");
      expect(verbs).not.toContain("RCPT");
      expect(verbs).not.toContain("DATA");
      expect(verbs).not.toContain("AUTH");
    } finally {
      await server.close();
    }
  });

  it("signale l'absence de STARTTLS quand TLS est exigé", async () => {
    const server = await startFakeSmtp({ advertiseStarttls: false });

    try {
      const probe = await probeSmtpConnection({
        host: "127.0.0.1",
        port: server.port,
        encryption: "starttls",
        requireTls: true,
        timeoutMs: 3000,
      });

      expect(probe.tls.negotiated).toBe(false);
      expect(probe.errors.map((e) => e.code)).toContain("STARTTLS_UNAVAILABLE");
      expect(probe.errors[0].message).toMatch(/exigé/i);
    } finally {
      await server.close();
    }
  });

  it("remonte une erreur TCP sans lever d'exception", async () => {
    const probe = await probeSmtpConnection({
      host: "127.0.0.1",
      // Port fermé : ECONNREFUSED immédiat.
      port: 9,
      encryption: "none",
      timeoutMs: 2000,
    });

    expect(probe.reachable).toBe(false);
    expect(probe.errors).toHaveLength(1);
    expect(probe.errors[0].stage).toBe("tcp");
  });

  it("échoue proprement sur une bannière inattendue", async () => {
    const server = await startFakeSmtp({ greeting: "554 Service unavailable" });

    try {
      const probe = await probeSmtpConnection({
        host: "127.0.0.1",
        port: server.port,
        encryption: "none",
        timeoutMs: 3000,
      });

      expect(probe.reachable).toBe(true);
      expect(probe.errors[0].code).toBe("554");
    } finally {
      await server.close();
    }
  });
});

describe("Phase 2 — quota fournisseur", () => {
  it("produit une requête canonique SigV4 conforme", () => {
    const canonical = buildSigv4CanonicalRequest({
      method: "GET",
      host: "email.eu-west-1.amazonaws.com",
      path: "/v2/email/account",
      region: "eu-west-1",
      service: "ses",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
      payload: "",
      amzDate: "20260801T053000Z",
    });

    const lines = canonical.split("\n");
    expect(lines[0]).toBe("GET");
    expect(lines[1]).toBe("/v2/email/account");
    expect(lines[2]).toBe("");
    expect(canonical).toContain("host:email.eu-west-1.amazonaws.com");
    expect(canonical).toContain("x-amz-date:20260801T053000Z");
    expect(canonical).toContain("host;x-amz-content-sha256;x-amz-date");
    // SHA-256 du corps vide
    expect(canonical).toContain(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("signe de façon déterministe et dépendante du secret", () => {
    const base = {
      method: "GET",
      host: "email.eu-west-1.amazonaws.com",
      path: "/v2/email/account",
      region: "eu-west-1",
      service: "ses",
      accessKeyId: "AKIAEXAMPLE",
      payload: "",
      amzDate: "20260801T053000Z",
    };

    const first = buildSigv4Headers({ ...base, secretAccessKey: "secret-a" });
    const same = buildSigv4Headers({ ...base, secretAccessKey: "secret-a" });
    const other = buildSigv4Headers({ ...base, secretAccessKey: "secret-b" });

    expect(first.Authorization).toBe(same.Authorization);
    expect(first.Authorization).not.toBe(other.Authorization);
    expect(first.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260801\/eu-west-1\/ses\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(first.Authorization).not.toContain("secret-a");
  });

  it("formate l'horodatage AWS", () => {
    expect(toAmzDate(new Date("2026-08-01T05:30:00.123Z"))).toBe(
      "20260801T053000Z",
    );
  });

  it("dégrade proprement quand la clé est absente", async () => {
    setEnv({ MAIL_PROVIDER: "brevo", BREVO_API_KEY: "" });
    const quota = await fetchProviderQuota({
      remoteQuota: "brevo",
      label: "Brevo",
    });

    expect(quota.status).toBe("not_configured");
    expect(quota.limit).toBeNull();
  });

  it("indique que Mailgun n'expose pas de quota interrogeable", async () => {
    const quota = await fetchProviderQuota({
      remoteQuota: "none",
      label: "Mailgun",
    });

    expect(quota.status).toBe("unsupported");
    expect(quota.message).toContain("quotas locaux");
  });
});

function baseReport(overrides: Partial<SmtpHealthReport> = {}): SmtpHealthReport {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    lastTestAt: now,
    durationMs: 10,
    status: "unknown",
    cached: false,
    probeSendsEmail: false,
    connector: {
      id: "brevo",
      label: "Brevo",
      hostMasked: "sm***.brevo.com",
      port: 587,
      encryption: "starttls",
      requireTls: true,
      hostSource: "preset",
      credentialsConfigured: true,
      fromName: "BotoSchool",
      fromEmail: "noreply@botoschool.com",
      docsUrl: "https://example.test",
    },
    connection: {
      reachable: true,
      greeting: "220 ok",
      capabilities: [],
      starttlsAdvertised: true,
      authMechanisms: ["PLAIN"],
      maxMessageBytes: null,
      tls: {
        negotiated: true,
        mode: "starttls",
        protocol: "TLSv1.3",
        cipher: "TLS_AES_256_GCM_SHA384",
        authorized: true,
        authorizationError: null,
      },
    },
    certificate: {
      subject: "smtp-relay.brevo.com",
      issuer: "Let's Encrypt",
      validFrom: now,
      validTo: now,
      daysRemaining: 60,
      expired: false,
      fingerprint256: "AA:BB",
      serialNumber: "01",
      altNames: [],
    },
    timings: {
      tcpMs: 20,
      greetingMs: 10,
      ehloMs: 5,
      tlsHandshakeMs: 30,
      totalMs: 65,
      authMs: 40,
    },
    authentication: { status: "ok", message: "ok", durationMs: 40 },
    quota: {
      local: [
        { label: "Global horaire", used: 10, limit: 200, window: "heure" },
      ],
      provider: {
        status: "ok",
        message: "ok",
        limit: 1000,
        used: 10,
        remaining: 990,
        ratePerSecond: 14,
        window: "24h",
        checkedAt: now,
      },
    },
    gates: {
      dryRun: true,
      productionSendingEnabled: false,
      allowTestSmtp: false,
      nodeEnv: "test",
      hostAllowlistConfigured: true,
    },
    errors: [],
    warnings: [],
    ...overrides,
  };
}

describe("Phase 2 — règles de statut Santé SMTP", () => {
  it("classe un connecteur nominal comme opérationnel", () => {
    expect(evaluateSmtpHealthStatus(baseReport()).status).toBe("healthy");
  });

  it("classe hors service un serveur injoignable", () => {
    const report = baseReport();
    report.connection.reachable = false;
    expect(evaluateSmtpHealthStatus(report).status).toBe("unhealthy");
  });

  it("classe hors service une authentification refusée", () => {
    const report = baseReport();
    report.authentication = {
      status: "failed",
      message: "535",
      durationMs: 5,
    };
    expect(evaluateSmtpHealthStatus(report).status).toBe("unhealthy");
  });

  it("dégrade un certificat proche de l'expiration", () => {
    const report = baseReport();
    report.certificate!.daysRemaining = 3;
    const result = evaluateSmtpHealthStatus(report);

    expect(result.status).toBe("degraded");
    expect(result.warnings.join(" ")).toMatch(/expire dans 3/);
  });

  it("dégrade un quota local saturé", () => {
    const report = baseReport();
    report.quota.local = [
      { label: "Global horaire", used: 195, limit: 200, window: "heure" },
    ];
    const result = evaluateSmtpHealthStatus(report);

    expect(result.status).toBe("degraded");
    expect(result.warnings.join(" ")).toContain("195/200");
  });

  it("dégrade une chaîne de certificat non validée", () => {
    const report = baseReport();
    report.connection.tls.authorized = false;
    report.connection.tls.authorizationError = "SELF_SIGNED_CERT_IN_CHAIN";
    expect(evaluateSmtpHealthStatus(report).status).toBe("degraded");
  });

  it("n'expose jamais l'hôte complet ni d'identifiant", () => {
    const serialized = JSON.stringify(baseReport());
    expect(serialized).not.toContain("smtp-relay.brevo.com:587");
    expect(serialized).toContain("sm***.brevo.com");
    expect(serialized).toContain('"probeSendsEmail":false');
  });
});

describe("Phase 2 — non-régression des garde-fous", () => {
  beforeEach(() => {
    setEnv({ MAIL_PROVIDER: "brevo", DRY_RUN: "true" });
  });

  it("conserve DRY_RUN par défaut et n'active aucun envoi", async () => {
    const { mustSimulateProviderSend } = await import(
      "@/lib/compliance/send-gates"
    );
    expect(mustSimulateProviderSend()).toBe(true);
  });

  it("garde getMailProviderConfig aligné sur le connecteur résolu", async () => {
    const { getMailProviderConfig } = await import("@/lib/mail/types");
    const config = getMailProviderConfig();
    const connector = resolveMailConnectorConfig();

    expect(config.host).toBe(connector.host);
    expect(config.port).toBe(connector.port);
    expect(config.secure).toBe(connector.secure);
  });
});
