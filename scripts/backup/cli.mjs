#!/usr/bin/env node
/**
 * Phase 10 — Backup CLI
 *
 *   node scripts/backup/cli.mjs backup [--compose=docker-compose.production.yml]
 *   node scripts/backup/cli.mjs verify [backup-id]
 *   node scripts/backup/cli.mjs restore <backup-id> --confirm=restore
 *   node scripts/backup/cli.mjs rotate
 *   node scripts/backup/cli.mjs all   # backup + rotate
 */
import { fail, log } from "./lib.mjs";

function parseArgs(argv) {
  const out = { _: [] };
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) out[arg.slice(2)] = true;
      else out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      out._.push(arg);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args.help || args._[0] === "help" ? "help" : args._[0];
  if (!cmd || cmd === "help") {
    console.log(`BotoSchool Backup CLI (Phase 10)

Commands:
  backup [--compose=FILE] [--dir=DIR]
  verify [backup-id] [--compose=FILE]
  restore <backup-id> --confirm=restore [--components=postgres,redis,uploads]
  rotate [--retention-days=N] [--retention-count=N]
  all    # backup then rotate

Env:
  BACKUP_DIR, BACKUP_COMPOSE_FILE, BACKUP_RETENTION_DAYS, BACKUP_RETENTION_COUNT
  POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
`);
    return;
  }

  const cliOpts = {
    composeFile: args.compose,
    backupDir: args.dir,
    id: args._[1],
    confirm: args.confirm,
    components: args.components,
    retentionDays: args["retention-days"],
    retentionCount: args["retention-count"],
  };

  if (cmd === "backup") {
    const { runBackup } = await import("./backup.mjs");
    const result = await runBackup(cliOpts);
    console.log(JSON.stringify({ ok: true, id: result.id }, null, 2));
    return;
  }

  if (cmd === "verify") {
    const { runVerify } = await import("./verify.mjs");
    await runVerify(cliOpts);
    return;
  }

  if (cmd === "restore") {
    if (!cliOpts.id) fail("restore requires <backup-id>");
    const { runRestore } = await import("./restore.mjs");
    const result = await runRestore(cliOpts);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (cmd === "rotate") {
    const { runRotate } = await import("./rotate.mjs");
    const result = await runRotate(cliOpts);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (cmd === "all") {
    const { runBackup } = await import("./backup.mjs");
    const { runRotate } = await import("./rotate.mjs");
    const backup = await runBackup(cliOpts);
    const rotate = await runRotate(cliOpts);
    console.log(
      JSON.stringify({ ok: true, backup: backup.id, rotate }, null, 2),
    );
    return;
  }

  fail(`Unknown command: ${cmd}`);
}

main().catch((error) => {
  log(error.stack || error.message);
  process.exit(1);
});
