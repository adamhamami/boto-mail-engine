# Host Task Scheduler helper — Phase 10
# Example: .\scripts\backup\schedule.ps1 -Target production
param(
  [ValidateSet("local", "staging", "production")]
  [string]$Target = "local"
)

$Root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Set-Location $Root

$compose = switch ($Target) {
  "production" { "docker-compose.production.yml" }
  "staging" { "docker-compose.staging.yml" }
  default { "docker-compose.yml" }
}

$env:BACKUP_COMPOSE_FILE = $compose
node scripts/backup/cli.mjs all --compose=$compose
