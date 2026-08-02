// Build & tag Docker images for v1.0.0 (Etape 11)
// Usage: node scripts/docker-tag-release.mjs
import { spawnSync } from "node:child_process";

const VERSION = "1.0.0";
const TAGS = [VERSION, `v${VERSION}`];

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

console.log(`Building Docker images for ${VERSION}...`);

run("docker", [
  "build",
  "-f",
  "Dockerfile",
  "--target",
  "app",
  ...TAGS.flatMap((t) => ["-t", `botoschool-app:${t}`]),
  ".",
]);

run("docker", [
  "build",
  "-f",
  "Dockerfile.worker",
  "--target",
  "worker",
  ...TAGS.flatMap((t) => ["-t", `botoschool-worker:${t}`]),
  ".",
]);

console.log("\nOK images:");
for (const t of TAGS) {
  console.log(`  botoschool-app:${t}`);
  console.log(`  botoschool-worker:${t}`);
}
console.log("\nDeploy example:");
console.log(
  `  APP_IMAGE=botoschool-app:${VERSION} WORKER_IMAGE=botoschool-worker:${VERSION} npm run docker:prod`,
);
