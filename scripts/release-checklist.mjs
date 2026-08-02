/**
 * Checklist release v1.0.0 (Étape 11) — n’exécute pas tag/docker (affichage + preuves).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const pkg = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);

/** @type {{ id: string; status: string; detail: string }[]} */
const checks = [];

function add(id, status, detail) {
  checks.push({ id, status, detail });
  const mark =
    status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "INFO";
  console.log(`${mark}  ${id} — ${detail}`);
}

function main() {
  console.log("=== Release checklist v1.0.0 ===\n");

  add(
    "version.package",
    pkg.version === "1.0.0" ? "pass" : "fail",
    `package.json version=${pkg.version}`,
  );

  const notes = path.join(root, "docs", "releases", "v1.0.0.md");
  add(
    "docs.release_notes",
    existsSync(notes) ? "pass" : "fail",
    "docs/releases/v1.0.0.md",
  );

  const finalDoc = path.join(root, "docs", "FINAL.md");
  add(
    "docs.final",
    existsSync(finalDoc) ? "pass" : "fail",
    "docs/FINAL.md",
  );

  const tag = spawnSync("git", ["tag", "-l", "v1.0.0"], {
    encoding: "utf8",
    shell: true,
  });
  const hasTag = (tag.stdout || "").trim() === "v1.0.0";
  add(
    "git.tag",
    hasTag ? "pass" : "info",
    hasTag ? "tag v1.0.0 présent" : "tag v1.0.0 à créer après commit",
  );

  add("backup", "info", "npm run backup — avant bascule / release");
  add(
    "docker.images",
    "info",
    "docker build … -t botoschool-app:1.0.0 / botoschool-worker:1.0.0",
  );
  add(
    "ramp",
    "info",
    "Envoi réel : 10→50→100→500→1000 uniquement (docs/production/12-…)",
  );
  add(
    "gates",
    "info",
    "Défaut : DRY_RUN=true PRODUCTION_SENDING_ENABLED=false",
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    version: pkg.version,
    tag: hasTag ? "v1.0.0" : null,
    checks,
    docs: [
      "docs/releases/v1.0.0.md",
      "docs/FINAL.md",
      "docs/implementation/34-ETAPE-11-VERSION-1.0.md",
    ],
  };

  const outDir = path.join(root, "docs", "final-audit");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "release-1.0.0.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  console.log("\nÉcrit docs/final-audit/release-1.0.0.json");
  process.exit(checks.some((c) => c.status === "fail") ? 1 : 0);
}

main();
