/**
 * Checklist DNS email (Étape 8) — affichage + lookups optionnels.
 * Ne modifie aucune gate DRY_RUN.
 *
 * DNS_CHECK_DOMAIN=mail.example.com npm run dns:checklist
 */
import { promises as dns } from "node:dns";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const domain = (process.env.DNS_CHECK_DOMAIN ?? "")
  .trim()
  .toLowerCase()
  .replace(/\.$/, "");

/** @type {{ id: string; status: string; detail: string }[]} */
const checks = [];

function add(id, status, detail) {
  checks.push({ id, status, detail });
  const mark =
    status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "INFO";
  console.log(`${mark}  ${id} — ${detail}`);
}

async function lookupTxt(name) {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((r) => r.join(""));
  } catch (e) {
    return {
      error: e instanceof Error ? e.code || e.message : String(e),
    };
  }
}

async function main() {
  console.log("=== Checklist DNS Email (Étape 8) ===\n");

  add(
    "process.dedicated_domain",
    "info",
    "Utiliser un sous-domaine dédié (mail. / noreply.)",
  );
  add(
    "process.records",
    "info",
    "Publier SPF + DKIM + DMARC + MX/null MX + PTR ESP",
  );
  add(
    "process.ops_ui",
    "info",
    "Valider /ops/dns — 0 CRITICAL avant sortie DRY_RUN",
  );
  add(
    "process.reputation",
    "info",
    "MXToolbox blacklist + Google Postmaster + SNDS si applicable",
  );
  add(
    "process.spam_score",
    "info",
    "mail-tester.com ≥ 8/10 sur envoi allowlist",
  );
  add(
    "process.headers",
    "info",
    "Authentication-Results : spf=pass dkim=pass dmarc=pass",
  );

  if (!domain) {
    add(
      "lookup.skipped",
      "info",
      "Définir DNS_CHECK_DOMAIN=… pour lookups TXT automatiques",
    );
  } else {
    console.log(`\nLookups pour ${domain}…\n`);
    const spf = await lookupTxt(domain);
    if (Array.isArray(spf)) {
      const spfRec = spf.filter((t) => t.startsWith("v=spf1"));
      add(
        "lookup.spf",
        spfRec.length === 1 ? "pass" : "fail",
        spfRec.length === 0
          ? "aucun SPF"
          : spfRec.length > 1
            ? `SPF multiples (${spfRec.length})`
            : spfRec[0].slice(0, 120),
      );
    } else {
      add("lookup.spf", "fail", String(spf.error));
    }

    const dmarc = await lookupTxt(`_dmarc.${domain}`);
    if (Array.isArray(dmarc)) {
      const rec = dmarc.find((t) => t.includes("v=DMARC1"));
      add(
        "lookup.dmarc",
        rec ? "pass" : "fail",
        rec ? rec.slice(0, 120) : "pas de DMARC",
      );
    } else {
      add("lookup.dmarc", "fail", String(dmarc.error));
    }

    try {
      const mx = await dns.resolveMx(domain);
      add(
        "lookup.mx",
        mx.length > 0 ? "pass" : "info",
        mx.length > 0
          ? mx.map((m) => `${m.priority} ${m.exchange}`).join(", ")
          : "aucun MX (envoi-only ?)",
      );
    } catch (e) {
      add(
        "lookup.mx",
        "info",
        e instanceof Error ? e.message : "MX lookup failed",
      );
    }

    add(
      "lookup.dkim",
      "info",
      "Vérifier via /ops/dns + DKIM_SELECTORS (CNAME ESP)",
    );
    add(
      "lookup.rdns",
      "info",
      "PTR sur IP SMTP — souvent géré par l’ESP",
    );
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    domain: domain || null,
    checks,
    next: [
      "Ouvrir /ops/dns",
      "mail-tester.com",
      "Postmaster Tools",
      "docs/production/06-DNS.md §5 GO grid",
    ],
  };

  const outDir = path.join(process.cwd(), "docs", "final-audit");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "dns-checklist.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  console.log("\nÉcrit docs/final-audit/dns-checklist.json");
  const failed = checks.filter((c) => c.status === "fail").length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
