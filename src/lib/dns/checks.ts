import type { DnsCheckFinding, DnsCheckStatus } from "./types";
import type { DnsResolver } from "./resolver";
import {
  resolveAddressesSafe,
  resolveMxSafe,
  resolveTxtSafe,
} from "./resolver";

/** Domaine FQDN simple — pas d'IP, pas de protocole, pas de chemin. */
const DOMAIN_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function isValidDnsDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.includes("..")) return false;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return false;
  }
  return DOMAIN_RE.test(normalized);
}

export function extractDomainFromEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  const domain = normalized.slice(at + 1).replace(/\.$/, "");
  return isValidDnsDomain(domain) ? domain : null;
}

export function parseCsvList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** Sélecteurs DKIM par défaut selon le connecteur — surchargeables via DKIM_SELECTORS. */
export function defaultDkimSelectors(mailProvider: string): string[] {
  switch (mailProvider) {
    case "brevo":
      return ["mail", "brevo"];
    case "mailgun":
      return ["mailo", "k1", "smtp"];
    case "postmark":
      return ["pm", "20230601", "20240701"];
    case "ses":
      return ["selector1", "selector2", "amazonses"];
    case "sendgrid":
      return ["s1", "s2", "smtpapi"];
    default:
      return ["default", "mail", "selector1", "selector2"];
  }
}

export function resolveDkimSelectors(
  mailProvider: string,
  envSelectors: string | undefined,
): string[] {
  const fromEnv = parseCsvList(envSelectors);
  if (fromEnv.length > 0) return fromEnv.slice(0, 12);
  return defaultDkimSelectors(mailProvider).slice(0, 12);
}

function finding(
  partial: Omit<DnsCheckFinding, "durationMs"> & { durationMs?: number },
): DnsCheckFinding {
  return { durationMs: 0, ...partial };
}

/** Extrait les enregistrements SPF (`v=spf1 …`). */
export function extractSpfRecords(txtRecords: string[]): string[] {
  return txtRecords.filter((record) =>
    record.trim().toLowerCase().startsWith("v=spf1"),
  );
}

/**
 * Évalue un enregistrement SPF déjà extrait.
 * Exporté pour les tests unitaires (pas de réseau).
 */
export function evaluateSpfRecords(spfRecords: string[]): DnsCheckFinding {
  if (spfRecords.length === 0) {
    return finding({
      id: "spf",
      label: "SPF",
      status: "ERROR",
      summary:
        "Aucun enregistrement SPF publié — les destinataires peuvent marquer vos emails comme spam ou les rejeter.",
      details: [
        "Publiez un enregistrement TXT sur le domaine d'envoi commençant par v=spf1.",
        "Incluez les mécanismes de votre fournisseur (include:…) puis terminez par -all.",
      ],
      records: [],
    });
  }

  if (spfRecords.length > 1) {
    return finding({
      id: "spf",
      label: "SPF",
      status: "ERROR",
      summary:
        "Plusieurs enregistrements SPF détectés — la RFC 7208 n'en autorise qu'un seul (comportement indéfini chez les destinataires).",
      details: [
        "Fusionnez tous les mécanismes dans un unique TXT v=spf1.",
        "Les includes imbriqués comptent dans la limite de 10 lookups DNS.",
      ],
      records: spfRecords,
    });
  }

  const record = spfRecords[0];
  const lower = record.toLowerCase();
  const details: string[] = [];
  let status: DnsCheckStatus = "OK";
  let summary = "SPF présent et policy restrictive (-all).";

  /** Qualifiant du mécanisme `all` final : +, -, ~, ? ou absent (= +). */
  const allMatch = /(?:^|\s)([+\-~?]?)all(?:\s|$)/i.exec(lower);
  const allQualifier = allMatch ? (allMatch[1] || "+") : null;

  if (allQualifier === "+") {
    status = "ERROR";
    summary =
      "SPF termine par +all (ou all) — n'importe qui peut émettre pour votre domaine.";
    details.push("Remplacez +all par -all (recommandé) ou ~all (transition).");
  } else if (allQualifier === "?") {
    status = "WARNING";
    summary =
      "SPF termine par ?all (neutral) — peu d'effet pratique pour les destinataires.";
    details.push("Passez à ~all puis -all une fois les includes validés.");
  } else if (allQualifier === "~") {
    status = "WARNING";
    summary =
      "SPF termine par ~all (softfail) — utile en transition, insuffisant en production.";
    details.push(
      "Après validation des includes fournisseur, durcissez en -all.",
    );
  } else if (allQualifier === null) {
    status = "WARNING";
    summary =
      "SPF sans mécanisme all explicite — les destinataires peuvent traiter le reste comme neutral.";
    details.push("Ajoutez -all en fin d'enregistrement.");
  } else if (allQualifier === "-") {
    summary = "SPF présent avec policy stricte (-all).";
  }

  if (!/\binclude:|\ba:|\bmx\b|\bip4:|\bip6:/.test(lower)) {
    if (status === "OK") status = "WARNING";
    details.push(
      "Aucun mécanisme d'autorisation explicite (include:/ip4:/mx) — vérifiez que votre fournisseur est bien couvert.",
    );
  }

  const lookupTokens = lower.match(/\b(?:include|a|mx|ptr|exists|redirect):/g);
  if (lookupTokens && lookupTokens.length > 10) {
    status = "ERROR";
    summary =
      "SPF dépasse probablement la limite de 10 lookups DNS — les destinataires peuvent ignorer l'enregistrement.";
    details.push(`Mécanismes générant des lookups détectés : ${lookupTokens.length}.`);
  }

  if (details.length === 0) {
    details.push("Un seul enregistrement v=spf1, policy -all.");
  }

  return finding({
    id: "spf",
    label: "SPF",
    status,
    summary,
    details,
    records: spfRecords,
  });
}

export function evaluateDkimRecords(input: {
  selectorsTried: string[];
  found: Array<{ selector: string; records: string[] }>;
  lookupError?: string | null;
}): DnsCheckFinding {
  if (input.lookupError) {
    return finding({
      id: "dkim",
      label: "DKIM",
      status: "ERROR",
      summary: `Échec de résolution DNS pour DKIM : ${input.lookupError}`,
      details: [
        "Vérifiez la connectivité DNS du serveur applicatif.",
        "Réessayez plus tard ; un SERVFAIL temporaire ne signifie pas l'absence de clé.",
      ],
      records: [],
    });
  }

  if (input.selectorsTried.length === 0) {
    return finding({
      id: "dkim",
      label: "DKIM",
      status: "ERROR",
      summary: "Aucun sélecteur DKIM configuré à tester.",
      details: [
        "Définissez DKIM_SELECTORS (CSV) avec le ou les sélecteurs fournis par votre ESP.",
      ],
      records: [],
    });
  }

  const valid: Array<{ selector: string; record: string }> = [];
  const revoked: string[] = [];
  const invalid: string[] = [];

  for (const entry of input.found) {
    for (const record of entry.records) {
      const lower = record.toLowerCase();
      if (!lower.includes("v=dkim1") && !/\bp=/.test(lower)) {
        invalid.push(`${entry.selector}: enregistrement non DKIM`);
        continue;
      }
      const keyMatch = /(?:^|;)\s*p=([^;]*)/i.exec(record);
      const key = keyMatch?.[1]?.trim() ?? "";
      if (key.length === 0) {
        revoked.push(entry.selector);
        continue;
      }
      valid.push({ selector: entry.selector, record });
    }
  }

  if (valid.length === 0 && revoked.length > 0) {
    return finding({
      id: "dkim",
      label: "DKIM",
      status: "ERROR",
      summary:
        "Clé(s) DKIM révoquée(s) (p= vide) — la signature sera rejetée par les destinataires.",
      details: [
        `Sélecteurs révoqués : ${revoked.join(", ")}.`,
        "Publiez une nouvelle clé publique chez votre fournisseur.",
      ],
      records: input.found.flatMap((f) => f.records),
    });
  }

  if (valid.length === 0) {
    return finding({
      id: "dkim",
      label: "DKIM",
      status: "ERROR",
      summary: `Aucune clé DKIM trouvée pour les sélecteurs testés (${input.selectorsTried.join(", ")}).`,
      details: [
        "Chez l'ESP, activez la signature DKIM et publiez le TXT selector._domainkey.votre-domaine.",
        "Si votre sélecteur est personnalisé, renseignez DKIM_SELECTORS.",
        ...(invalid.length > 0 ? invalid.slice(0, 5) : []),
      ],
      records: [],
    });
  }

  const details = valid.map(
    (item) =>
      `Sélecteur « ${item.selector} » : clé publique présente (v=DKIM1).`,
  );
  if (revoked.length > 0) {
    details.push(
      `Attention : sélecteurs révoqués encore publiés : ${revoked.join(", ")}.`,
    );
  }

  return finding({
    id: "dkim",
    label: "DKIM",
    status: revoked.length > 0 ? "WARNING" : "OK",
    summary:
      revoked.length > 0
        ? `${valid.length} clé(s) DKIM valide(s), ${revoked.length} révoquée(s).`
        : `${valid.length} clé(s) DKIM valide(s) détectée(s).`,
    details,
    records: valid.map((v) => `${v.selector}: ${truncateRecord(v.record)}`),
  });
}

export function evaluateDmarcRecords(txtRecords: string[]): DnsCheckFinding {
  const dmarc = txtRecords.filter((record) =>
    record.trim().toLowerCase().startsWith("v=dmarc1"),
  );

  if (dmarc.length === 0) {
    return finding({
      id: "dmarc",
      label: "DMARC",
      status: "ERROR",
      summary:
        "Aucun enregistrement DMARC — impossible d'imposer une politique d'authentification aux destinataires.",
      details: [
        "Publiez un TXT sur _dmarc.votre-domaine (ex. v=DMARC1; p=none; rua=mailto:…).",
        "Commencez par p=none pour collecter les rapports, puis quarantine/reject.",
      ],
      records: [],
    });
  }

  if (dmarc.length > 1) {
    return finding({
      id: "dmarc",
      label: "DMARC",
      status: "ERROR",
      summary: "Plusieurs enregistrements DMARC — un seul est autorisé.",
      details: ["Conservez un unique TXT v=DMARC1 sur _dmarc."],
      records: dmarc,
    });
  }

  const record = dmarc[0];
  const policyMatch = /(?:^|;)\s*p\s*=\s*([a-z]+)/i.exec(record);
  const policy = (policyMatch?.[1] ?? "").toLowerCase();
  const hasRua = /(?:^|;)\s*rua\s*=/i.test(record);
  const details: string[] = [];
  let status: DnsCheckStatus = "OK";
  let summary = "DMARC présent.";

  if (policy === "reject") {
    summary = "DMARC en p=reject — politique stricte adaptée à la production.";
  } else if (policy === "quarantine") {
    summary =
      "DMARC en p=quarantine — les échecs d'auth sont mis en spam (bon compromis).";
  } else if (policy === "none") {
    status = "WARNING";
    summary =
      "DMARC en p=none — mode observation uniquement, aucun impact sur la livraison.";
    details.push(
      "Après analyse des rapports, passez à p=quarantine puis p=reject.",
    );
  } else {
    status = "WARNING";
    summary = policy
      ? `DMARC avec policy « ${policy} » non standard.`
      : "DMARC sans directive p= explicite.";
    details.push("Ajoutez p=none|quarantine|reject.");
  }

  if (!hasRua) {
    if (status === "OK") status = "WARNING";
    details.push(
      "Aucun rua= — vous ne recevrez pas de rapports agrégés DMARC.",
    );
  }

  if (details.length === 0) {
    details.push("Un seul enregistrement v=DMARC1 avec policy explicite.");
  }

  return finding({
    id: "dmarc",
    label: "DMARC",
    status,
    summary,
    details,
    records: dmarc,
  });
}

export function evaluateMxRecords(
  records: Array<{ exchange: string; priority: number }>,
): DnsCheckFinding {
  if (records.length === 0) {
    return finding({
      id: "mx",
      label: "MX",
      status: "ERROR",
      summary:
        "Aucun enregistrement MX — la réception (et souvent la réputation d'envoi) est compromise.",
      details: [
        "Publiez au moins un MX vers votre messagerie ou celle de votre hébergeur.",
        "L'absence de MX n'empêche pas l'envoi SMTP, mais dégrade fortement la délivrabilité.",
      ],
      records: [],
    });
  }

  const exchanges = records.map((r) => r.exchange.toLowerCase().replace(/\.$/, ""));
  const details = records.map(
    (r) => `priorité ${r.priority} → ${r.exchange}`,
  );

  if (exchanges.every((ex) => ex === "localhost" || ex.endsWith(".invalid"))) {
    return finding({
      id: "mx",
      label: "MX",
      status: "ERROR",
      summary: "Les MX pointent vers localhost / .invalid — configuration invalide.",
      details,
      records: exchanges,
    });
  }

  const nullMx = exchanges.some((ex) => ex === "" || ex === ".");
  if (nullMx && records.length === 1) {
    return finding({
      id: "mx",
      label: "MX",
      status: "WARNING",
      summary:
        "Null MX (RFC 7505) — le domaine refuse volontairement le courrier entrant.",
      details: [
        ...details,
        "Acceptable pour un domaine d'envoi pur, à condition que SPF/DKIM/DMARC soient solides.",
      ],
      records: exchanges,
    });
  }

  return finding({
    id: "mx",
    label: "MX",
    status: "OK",
    summary: `${records.length} serveur(s) MX publié(s).`,
    details,
    records: exchanges,
  });
}

export function evaluateReverseDns(input: {
  smtpHost: string;
  addresses: string[];
  ptrByIp: Record<string, string[]>;
  lookupError?: string | null;
}): DnsCheckFinding {
  const host = input.smtpHost.trim().toLowerCase().replace(/\.$/, "");

  if (input.lookupError && input.addresses.length === 0) {
    return finding({
      id: "rdns",
      label: "Reverse DNS",
      status: "ERROR",
      summary: `Impossible de résoudre l'hôte SMTP pour le PTR : ${input.lookupError}`,
      details: [
        "Vérifiez SMTP_HOST / le preset fournisseur et la connectivité DNS.",
      ],
      records: [],
    });
  }

  if (input.addresses.length === 0) {
    return finding({
      id: "rdns",
      label: "Reverse DNS",
      status: "WARNING",
      summary: `Aucune adresse IP trouvée pour « ${host} » — PTR non vérifiable.`,
      details: [
        "Sur un relais ESP partagé, le PTR est géré par le fournisseur.",
        "Si vous envoyez depuis votre propre IP, publiez un enregistrement A puis un PTR matching.",
      ],
      records: [],
    });
  }

  const details: string[] = [];
  let withPtr = 0;
  let withoutPtr = 0;

  for (const ip of input.addresses) {
    const ptrs = input.ptrByIp[ip] ?? [];
    if (ptrs.length === 0) {
      withoutPtr += 1;
      details.push(`${ip} → (aucun PTR)`);
    } else {
      withPtr += 1;
      details.push(`${ip} → ${ptrs.join(", ")}`);
    }
  }

  if (withPtr === 0) {
    return finding({
      id: "rdns",
      label: "Reverse DNS",
      status: "ERROR",
      summary:
        "Aucun PTR (reverse DNS) sur les IP du relais SMTP — nombreux filtres anti-spam pénalisent cette absence.",
      details: [
        ...details,
        "Chez un ESP, contactez le support ; en IP dédiée, demandez le PTR à votre hébergeur.",
      ],
      records: input.addresses,
    });
  }

  if (withoutPtr > 0) {
    return finding({
      id: "rdns",
      label: "Reverse DNS",
      status: "WARNING",
      summary: `PTR présent sur ${withPtr}/${input.addresses.length} adresse(s) du relais.`,
      details,
      records: input.addresses,
    });
  }

  return finding({
    id: "rdns",
    label: "Reverse DNS",
    status: "OK",
    summary: `PTR présent pour toutes les IP résolues de « ${host} ».`,
    details,
    records: input.addresses,
  });
}

function truncateRecord(record: string, max = 160): string {
  if (record.length <= max) return record;
  return `${record.slice(0, max)}…`;
}

export function aggregateDnsStatus(
  checks: Array<{ status: DnsCheckStatus }>,
): DnsCheckStatus {
  if (checks.some((c) => c.status === "ERROR")) return "ERROR";
  if (checks.some((c) => c.status === "WARNING")) return "WARNING";
  return "OK";
}

/** Exécute les 5 contrôles pour un domaine + hôte SMTP. */
export async function runDnsChecks(input: {
  domain: string;
  smtpHost: string;
  mailProvider: string;
  dkimSelectors: string[];
  resolver: DnsResolver;
}): Promise<{
  checks: DnsCheckFinding[];
  dkimSelectorsTried: string[];
}> {
  const domain = input.domain.toLowerCase().replace(/\.$/, "");
  const smtpHost = input.smtpHost.toLowerCase().replace(/\.$/, "");

  const spfStarted = Date.now();
  const spfTxt = await resolveTxtSafe(input.resolver, domain);
  const spf = evaluateSpfRecords(extractSpfRecords(spfTxt.records));
  if (spfTxt.error) {
    spf.status = "ERROR";
    spf.summary = `Échec DNS SPF : ${spfTxt.error}`;
  }
  spf.durationMs = Date.now() - spfStarted;

  const dkimStarted = Date.now();
  const found: Array<{ selector: string; records: string[] }> = [];
  let dkimLookupError: string | null = null;
  for (const selector of input.dkimSelectors) {
    const host = `${selector}._domainkey.${domain}`;
    const result = await resolveTxtSafe(input.resolver, host);
    if (result.error) dkimLookupError = result.error;
    if (result.records.length > 0) {
      found.push({ selector, records: result.records });
    }
  }
  const dkim = evaluateDkimRecords({
    selectorsTried: input.dkimSelectors,
    found,
    lookupError: found.length === 0 ? dkimLookupError : null,
  });
  dkim.durationMs = Date.now() - dkimStarted;

  const dmarcStarted = Date.now();
  const dmarcTxt = await resolveTxtSafe(input.resolver, `_dmarc.${domain}`);
  const dmarc = evaluateDmarcRecords(dmarcTxt.records);
  if (dmarcTxt.error) {
    dmarc.status = "ERROR";
    dmarc.summary = `Échec DNS DMARC : ${dmarcTxt.error}`;
  }
  dmarc.durationMs = Date.now() - dmarcStarted;

  const mxStarted = Date.now();
  const mxResult = await resolveMxSafe(input.resolver, domain);
  const mx = evaluateMxRecords(mxResult.records);
  if (mxResult.error) {
    mx.status = "ERROR";
    mx.summary = `Échec DNS MX : ${mxResult.error}`;
  }
  mx.durationMs = Date.now() - mxStarted;

  const rdnsStarted = Date.now();
  const addr = await resolveAddressesSafe(input.resolver, smtpHost);
  const ptrByIp: Record<string, string[]> = {};
  for (const ip of addr.addresses) {
    try {
      ptrByIp[ip] = await input.resolver.reverse(ip);
    } catch {
      ptrByIp[ip] = [];
    }
  }
  const rdns = evaluateReverseDns({
    smtpHost,
    addresses: addr.addresses,
    ptrByIp,
    lookupError: addr.error,
  });
  rdns.durationMs = Date.now() - rdnsStarted;

  return {
    checks: [spf, dkim, dmarc, mx, rdns],
    dkimSelectorsTried: input.dkimSelectors,
  };
}
