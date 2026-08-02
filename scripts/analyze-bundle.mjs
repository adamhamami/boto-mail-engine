#!/usr/bin/env node
/** Lance next build avec ANALYZE=true (Phase 11 bundle). */
import { spawn } from "node:child_process";

process.env.ANALYZE = "true";
const child = spawn("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
