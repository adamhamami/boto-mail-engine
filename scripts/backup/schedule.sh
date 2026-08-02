#!/usr/bin/env bash
# Host cron helper — Phase 10
# crontab -e :
#   0 2 * * * /path/to/hassan/scripts/backup/schedule.sh production >> /var/log/botoschool-backup.log 2>&1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

TARGET="${1:-local}"
case "$TARGET" in
  production) COMPOSE="docker-compose.production.yml" ;;
  staging)    COMPOSE="docker-compose.staging.yml" ;;
  local)      COMPOSE="docker-compose.yml" ;;
  *) echo "Usage: $0 [local|staging|production]"; exit 1 ;;
esac

export BACKUP_COMPOSE_FILE="$COMPOSE"
node scripts/backup/cli.mjs all --compose="$COMPOSE"
