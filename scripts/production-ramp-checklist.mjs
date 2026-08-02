/**
 * Rampe production contrôlée (Étape 10).
 * N’active aucune gate — affiche quotas + critères GO du palier.
 *
 * RAMP_STAGE=R0|R1|R2|R3|R4|R5  (défaut R0)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/** @typedef {{ id: string; label: string; day: number; hour: number; campaign: number; minDuration: string; go: string[]; forbid: string }} Stage */

/** @type {Stage[]} */
const STAGES = [
  {
    id: "R0",
    label: "10 emails (allowlist)",
    day: 10,
    hour: 5,
    campaign: 10,
    minDuration: "2–4 h",
    go: ["10 SENT", "0 hard bounce", "SMTP healthy"],
    forbid: "Ne pas programmer > 10 destinataires",
  },
  {
    id: "R1",
    label: "50 emails",
    day: 50,
    hour: 15,
    campaign: 50,
    minDuration: "24 h",
    go: ["bounce < 3%", "failure < 5%", "DLQ 0"],
    forbid: "Ne pas sauter vers R3+",
  },
  {
    id: "R2",
    label: "100 emails",
    day: 100,
    hour: 25,
    campaign: 100,
    minDuration: "24–48 h",
    go: ["idem R1", "plaintes ≈ 0"],
    forbid: "Pas de 100 → 1000 en une journée",
  },
  {
    id: "R3",
    label: "500 emails",
    day: 500,
    hour: 80,
    campaign: 250,
    minDuration: "3–5 j",
    go: ["bounce < 2%", "monitoring vert"],
    forbid: "Pas de blast multi-milliers",
  },
  {
    id: "R4",
    label: "1000 emails",
    day: 1000,
    hour: 150,
    campaign: 500,
    minDuration: "5–7 j",
    go: ["Postmaster/SNDS OK", "DLQ 0"],
    forbid: "Pas de ×5 overnight",
  },
  {
    id: "R5",
    label: "Augmentation progressive",
    day: 0,
    hour: 0,
    campaign: 0,
    minDuration: "continu (+20–50%/semaine max)",
    go: ["tous GO verts sur 7 j", "réputation stable"],
    forbid: "Jamais plusieurs milliers d’un coup depuis R0–R2",
  },
];

const stageId = (process.env.RAMP_STAGE || "R0").trim().toUpperCase();
const stage = STAGES.find((s) => s.id === stageId) || STAGES[0];

function main() {
  console.log("=== Production contrôlée — rampe ===\n");
  console.log("Séquence : 10 → 50 → 100 → 500 → 1000 → progressif\n");

  for (const s of STAGES) {
    const mark = s.id === stage.id ? "→" : " ";
    const quotas =
      s.id === "R5"
        ? "+20–50%/semaine (cap ESP)"
        : `day=${s.day} hour=${s.hour} campaign=${s.campaign}`;
    console.log(`${mark} ${s.id}  ${s.label.padEnd(28)} ${quotas}`);
  }

  console.log(`\n--- Palier courant : ${stage.id} (${stage.label}) ---\n`);
  if (stage.id !== "R5") {
    console.log("Env recommandé :");
    console.log(`  SEND_QUOTA_PER_DAY=${stage.day}`);
    console.log(`  SEND_QUOTA_PER_HOUR=${stage.hour}`);
    console.log(`  SEND_QUOTA_PER_CAMPAIGN=${stage.campaign}`);
  } else {
    console.log("Env : augmenter progressivement depuis R4 (jamais reset à des milliers).");
  }
  console.log(`Durée min. : ${stage.minDuration}`);
  console.log("GO :");
  for (const g of stage.go) console.log(`  - ${g}`);
  console.log(`Interdit : ${stage.forbid}`);
  console.log("\nKill switch si doute :");
  console.log("  1) PRODUCTION_SENDING_ENABLED=false");
  console.log("  2) DRY_RUN=true");
  console.log("  3) restart app+worker · pause campagnes");

  const summary = {
    generatedAt: new Date().toISOString(),
    sequence: ["10", "50", "100", "500", "1000", "progressive"],
    currentStage: stage,
    allStages: STAGES,
    rule: "Never jump directly to several thousand emails",
    docs: ["docs/production/12-PRODUCTION-CONTROLEE.md"],
  };

  const outDir = path.join(process.cwd(), "docs", "final-audit");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "production-ramp.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  console.log("\nÉcrit docs/final-audit/production-ramp.json");
}

main();
