# Staging Docker deploy — BotoSchool (pré-production Mailpit + DRY_RUN)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path ".env.staging")) {
  if (Test-Path ".env.staging.example") {
    Copy-Item ".env.staging.example" ".env.staging"
    Write-Host "Created .env.staging from example — fill AUTH_SECRET / secrets if needed"
  } else {
    Write-Error "Missing .env.staging — copy .env.staging.example"
  }
}

if (-not (Test-Path "secrets/postgres_password.txt") -or -not (Test-Path "secrets/auth_secret.txt")) {
  Write-Host "Preparing Docker secrets..."
  node scripts/prepare-docker-secrets.mjs
}

$compose = @("compose", "-f", "docker-compose.staging.yml", "--env-file", ".env.staging")
$appPort = if ($env:APP_PORT) { $env:APP_PORT } else { "3001" }
$mailpitUi = if ($env:MAILPIT_UI_PORT) { $env:MAILPIT_UI_PORT } else { "8026" }

Write-Host "Building and starting staging stack (DRY_RUN=true)..."
docker @compose up -d --build

Write-Host "Waiting for postgres..."
Start-Sleep -Seconds 12

Write-Host "Running migrations..."
docker @compose exec -T app npx prisma migrate deploy

Write-Host "Seeding (idempotent)..."
try {
  docker @compose exec -T app npx prisma db seed
} catch {
  Write-Warning "Seed via container failed — run from host with staging DATABASE_URL if needed"
}

Write-Host "Health check..."
$ready = $false
for ($i = 0; $i -lt 12; $i++) {
  try {
    Invoke-RestMethod "http://localhost:$appPort/api/health/ready" | Out-Null
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 5
  }
}
if (-not $ready) {
  Write-Warning "Ready not OK yet — check docker compose logs"
} else {
  Write-Host "Ready OK"
}

Write-Host ""
Write-Host "Staging deploy complete (gates: DRY_RUN=true, PRODUCTION_SENDING_ENABLED=false)"
Write-Host "  App:     http://localhost:$appPort"
Write-Host "  Mailpit: http://localhost:$mailpitUi"
Write-Host "  Smoke:   npm run smoke:staging"
Write-Host "  Guide:   docs/production/11-STAGING.md"
