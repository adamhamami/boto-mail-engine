#!/usr/bin/env bash
set -euo pipefail

# Staging Docker deploy — Mailpit + DRY_RUN (pré-production)
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE=(docker compose -f docker-compose.staging.yml --env-file .env.staging)

if [[ ! -f .env.staging ]]; then
  if [[ -f .env.staging.example ]]; then
    cp .env.staging.example .env.staging
    echo "Created .env.staging from example"
  else
    echo "Missing .env.staging"
    exit 1
  fi
fi

if [[ ! -f secrets/postgres_password.txt || ! -f secrets/auth_secret.txt ]]; then
  echo "▶ Preparing Docker secrets..."
  node scripts/prepare-docker-secrets.mjs
fi

APP_PORT="${APP_PORT:-3001}"
MAILPIT_UI_PORT="${MAILPIT_UI_PORT:-8026}"

echo "▶ Building and starting staging stack (DRY_RUN=true)..."
"${COMPOSE[@]}" up -d --build

echo "▶ Waiting for postgres..."
sleep 12

echo "▶ Migrations..."
"${COMPOSE[@]}" exec -T app npx prisma migrate deploy

echo "▶ Seed..."
"${COMPOSE[@]}" exec -T app npx prisma db seed || echo "⚠ Seed via container failed — optional from host"

echo "▶ Health..."
for i in $(seq 1 12); do
  if curl -fsS "http://localhost:${APP_PORT}/api/health/ready" >/dev/null; then
    echo "Ready OK"
    break
  fi
  sleep 5
done

echo ""
echo "✅ Staging deploy complete"
echo "   App:     http://localhost:${APP_PORT}"
echo "   Mailpit: http://localhost:${MAILPIT_UI_PORT}"
echo "   Smoke:   npm run smoke:staging"
echo "   Guide:   docs/production/11-STAGING.md"
echo "   Gates:   DRY_RUN=true · PRODUCTION_SENDING_ENABLED=false"
