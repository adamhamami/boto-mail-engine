/**
 * Checklist SMTP réel (Étape 9) — n’active aucune gate.
 * SMTP_CHECK_PROVIDER=brevo|mailgun|ses|sendgrid|postmark|smtp
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const provider = (
  process.env.SMTP_CHECK_PROVIDER ||
  process.env.MAIL_PROVIDER ||
  "smtp"
)
  .trim()
  .toLowerCase();

/** @type {Record<string, { host: string; userHint: string; allowlist: string; notes: string[] }>} */
const PRESETS = {
  brevo: {
    host: "smtp-relay.brevo.com",
    userHint: "login Brevo",
    allowlist: "smtp-relay.brevo.com",
    notes: [
      "SMTP key (pas API v3) dans SMTP_PASSWORD",
      "Option BREVO_API_KEY pour quota UI",
      "DKIM_SELECTORS=mail,brevo",
    ],
  },
  mailgun: {
    host: "smtp.mailgun.org (EU: smtp.eu.mailgun.org)",
    userHint: "postmaster@domaine",
    allowlist: "smtp.mailgun.org ou smtp.eu.mailgun.org",
    notes: [
      "Surcharger SMTP_HOST pour EU",
      "Allowlist = hôte réellement utilisé",
    ],
  },
  ses: {
    host: "email-smtp.<SES_REGION>.amazonaws.com",
    userHint: "SMTP username IAM dérivé",
    allowlist: "email-smtp.<region>.amazonaws.com",
    notes: [
      "SMTP creds ≠ Access Key classiques",
      "Sortir du sandbox SES avant volume",
      "SES_* keys = quota lecture seule optionnel",
    ],
  },
  sendgrid: {
    host: "smtp.sendgrid.net",
    userHint: 'littéralement "apikey"',
    allowlist: "smtp.sendgrid.net",
    notes: ["SMTP_USER=apikey", "API Key avec Mail Send"],
  },
  postmark: {
    host: "smtp.postmarkapp.com",
    userHint: "Server API Token",
    allowlist: "smtp.postmarkapp.com",
    notes: ["USER = PASSWORD = Server Token"],
  },
  smtp: {
    host: "SMTP_HOST custom",
    userHint: "identifiant serveur",
    allowlist: "valeur de SMTP_HOST",
    notes: ["Mailpit OK en staging uniquement"],
  },
};

const p = PRESETS[provider] || PRESETS.smtp;

/** @type {{ id: string; status: string; detail: string }[]} */
const checks = [];

function add(id, status, detail) {
  checks.push({ id, status, detail });
  const mark =
    status === "pass" ? "PASS" : status === "warn" ? "WARN" : "INFO";
  console.log(`${mark}  ${id} — ${detail}`);
}

function main() {
  console.log(`=== Checklist SMTP réel — provider=${provider} ===\n`);

  add("provider.preset", "info", `Hôte typique : ${p.host}`);
  add("provider.user", "info", `SMTP_USER : ${p.userHint}`);
  add("provider.allowlist", "info", `SMTP_HOST_ALLOWLIST=${p.allowlist}`);
  for (const n of p.notes) {
    add("provider.note", "info", n);
  }

  add(
    "gates.default",
    "info",
    "Garder DRY_RUN=true + PRODUCTION_SENDING_ENABLED=false jusqu’à checklist GO",
  );
  add("preflight.dns", "info", "npm run dns:checklist + /ops/dns = 0 CRITICAL");
  add("preflight.smtp_ui", "info", "/ops/smtp → healthy (probe)");
  add("preflight.worker", "info", "Worker up + /api/health/ready");

  add("ramp.A", "info", "Étape 10 R0 : 10/jour — npm run ramp:checklist");
  add("ramp.B", "info", "Puis 50 → 100 → 500 → 1000 → progressif (ne jamais sauter)");
  add("ramp.C", "info", "Jamais plusieurs milliers d’emails d’un coup");
  add("ramp.D", "info", "docs/production/12-PRODUCTION-CONTROLEE.md");

  add(
    "monitor.window",
    "info",
    "30–60 min : /ops/monitoring #erreurs #alertes + Grafana SMTP",
  );
  add(
    "rollback.order",
    "info",
    "1) PRODUCTION_SENDING_ENABLED=false 2) DRY_RUN=true 3) restart 4) pause campagnes 5) révoquer clé ESP",
  );

  const dry = process.env.DRY_RUN;
  const prodSend = process.env.PRODUCTION_SENDING_ENABLED;
  if (dry === "false" && prodSend === "true") {
    add(
      "gates.live",
      "warn",
      "Envoi réel actif dans cet environnement — surveiller immédiatement",
    );
  } else {
    add(
      "gates.safe",
      "pass",
      `DRY_RUN=${dry ?? "?"} PRODUCTION_SENDING_ENABLED=${prodSend ?? "?"}`,
    );
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    provider,
    preset: p,
    checks,
    docs: [
      "docs/production/05-SMTP.md",
      "docs/implementation/32-ETAPE-9-SMTP-REEL.md",
    ],
  };

  const outDir = path.join(process.cwd(), "docs", "final-audit");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "smtp-checklist.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  console.log("\nÉcrit docs/final-audit/smtp-checklist.json");
}

main();
