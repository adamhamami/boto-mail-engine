import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const authSecret = randomBytes(32).toString("base64");
const webhookSecret = randomBytes(32).toString("base64");
const adminPassword = randomBytes(18).toString("base64url");
const dbPassword = randomBytes(24).toString("base64url");

const out = {
  AUTH_SECRET: authSecret,
  WEBHOOK_SECRET: webhookSecret,
  ADMIN_PASSWORD: adminPassword,
  POSTGRES_PASSWORD: dbPassword,
  generatedAt: new Date().toISOString(),
};

const credentialsPath = resolve(process.cwd(), ".credentials.local");
writeFileSync(
  credentialsPath,
  [
    "# Generated locally — DO NOT COMMIT",
    `# ${out.generatedAt}`,
    "",
    `AUTH_SECRET=${out.AUTH_SECRET}`,
    `WEBHOOK_SECRET=${out.WEBHOOK_SECRET}`,
    `ADMIN_PASSWORD=${out.ADMIN_PASSWORD}`,
    `POSTGRES_PASSWORD=${out.POSTGRES_PASSWORD}`,
    "",
    "# Rotation JWT : conservez l'ancien secret temporairement",
    "# AUTH_SECRET_PREVIOUS=<ancien AUTH_SECRET>",
    "",
  ].join("\n"),
  "utf8",
);

console.log("Secrets written to .credentials.local");
console.log("AUTH_SECRET length:", authSecret.length);
console.log("WEBHOOK_SECRET length:", webhookSecret.length);
console.log("ADMIN_PASSWORD written to .credentials.local (not echoed)");

if (!existsSync(resolve(process.cwd(), ".env"))) {
  console.log("No .env found — copy .env.example first");
}
