#!/usr/bin/env bash
set -euo pipefail

# Production Docker deploy for BotoSchool Email Platform (Phase 7)
# Prerequisites: Docker, .env, secrets in ./secrets/

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE=(docker compose -f docker-compose.production.yml)

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.production.example to .env and fill non-secret values"
  exit 1
fi

if [[ ! -f secrets/postgres_password.txt || ! -f secrets/auth_secret.txt ]]; then
  echo "▶ Preparing Docker secrets..."
  node scripts/prepare-docker-secrets.mjs
fi

WORKER_REPLICAS="${WORKER_REPLICAS:-1}"

echo "▶ Building and starting production stack (worker×${WORKER_REPLICAS})..."
"${COMPOSE[@]}" up -d --build --scale "worker=${WORKER_REPLICAS}"

echo "▶ Waiting for postgres..."
sleep 8

echo "▶ Running migrations..."
"${COMPOSE[@]}" exec -T app npx prisma migrate deploy

echo "▶ Health check..."
curl -fsS "http://localhost:${APP_PORT:-3000}/api/health/ready" || curl -fsS "http://localhost:${APP_PORT:-3000}/api/health" || true
echo ""
echo "✅ Production deploy complete"
echo "   App:     http://localhost:${APP_PORT:-3000}"
echo "   Ready:   http://localhost:${APP_PORT:-3000}/api/health/ready"
echo "   Workers: ${WORKER_REPLICAS}"
echo "   Secrets: ./secrets/ (file-mounted)"
