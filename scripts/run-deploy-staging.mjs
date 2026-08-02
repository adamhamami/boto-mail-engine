import { spawnSync } from "node:child_process";
import path from "node:path";

const isWin = process.platform === "win32";
const script = isWin
  ? path.join("scripts", "deploy-docker-staging.ps1")
  : path.join("scripts", "deploy-docker-staging.sh");

const result = isWin
  ? spawnSync(
      "powershell",
      ["-ExecutionPolicy", "Bypass", "-File", script],
      { stdio: "inherit", shell: true },
    )
  : spawnSync("bash", [script], { stdio: "inherit" });

process.exit(result.status ?? 1);
