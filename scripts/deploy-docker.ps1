# Production Docker deploy for BotoSchool Email Platform (Phase 7) — Windows
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path ".env")) {
  Write-Error "Missing .env — copy .env.production.example to .env and fill non-secret values"
}

if (-not (Test-Path "secrets/postgres_password.txt") -or -not (Test-Path "secrets/auth_secret.txt")) {
  Write-Host "Preparing Docker secrets..."
  node scripts/prepare-docker-secrets.mjs
}

$workerReplicas = if ($env:WORKER_REPLICAS) { $env:WORKER_REPLICAS } else { "1" }
$appPort = if ($env:APP_PORT) { $env:APP_PORT } else { "3000" }
$compose = @("compose", "-f", "docker-compose.production.yml")

Write-Host "Building and starting production stack (worker x $workerReplicas)..."
docker @compose up -d --build --scale "worker=$workerReplicas"

Write-Host "Waiting for postgres..."
Start-Sleep -Seconds 8

Write-Host "Running migrations..."
docker @compose exec -T app npx prisma migrate deploy

Write-Host "Health check..."
try {
  Invoke-RestMethod "http://localhost:$appPort/api/health/ready" | ConvertTo-Json
} catch {
  try {
    Invoke-RestMethod "http://localhost:$appPort/api/health" | ConvertTo-Json
  } catch {
    Write-Warning "Health check not ready yet — retry in a few seconds"
  }
}

Write-Host "Deploy complete"
Write-Host "  App:     http://localhost:$appPort"
Write-Host "  Workers: $workerReplicas"
Write-Host "  Secrets: ./secrets/"
