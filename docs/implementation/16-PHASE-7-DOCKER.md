# Phase 7 — Docker

Objectif : images multi-stage légères, Compose Production / Staging, healthchecks,
volumes, secrets Docker — sans casser le workflow local `docker:up`.

---

## 1. Livrables

| Élément | Fichier |
|---|---|
| Dockerfile optimisé (targets `deps` / `builder` / `app` / `worker`) | `Dockerfile` |
| Worker multi-stage léger (sans Next) | `Dockerfile.worker` |
| Compose local (postgres/redis/mailpit) | `docker-compose.yml` |
| Compose Production | `docker-compose.production.yml` |
| Compose Staging | `docker-compose.staging.yml` |
| Secrets | `./secrets/*.txt` + `npm run docker:secrets` |
| Healthchecks | app `/api/health/*`, worker Redis heartbeat |
| Volumes | postgres, redis, logs, tmp |
| `*_FILE` secrets | `src/lib/config/docker-secrets.ts` |

---

## 2. Images multi-stage / légères

### App (`Dockerfile` → `target: app`)

1. **deps** — `npm ci` (cache)
2. **builder** — `prisma generate` + `next build` (standalone)
3. **app** — Alpine + standalone + Prisma CLI minimal, user `nextjs`, no full `node_modules`

### Worker (`Dockerfile.worker`)

1. **deps** — install complet (prisma generate)
2. **builder** — `prisma generate` uniquement
3. **prod-deps** — `npm ci --omit=dev` + `tsx`
4. **worker** — sources + client généré, user `worker`

---

## 3. Secrets Docker

```bash
npm run docker:secrets
# fichiers : secrets/postgres_password.txt, auth_secret.txt, …
```

Compose monte les fichiers dans `/run/secrets/*`. L’app lit :

- `AUTH_SECRET_FILE`
- `WEBHOOK_SECRET_FILE`
- `POSTGRES_PASSWORD_FILE`
- `SMTP_PASSWORD_FILE`

et construit `DATABASE_URL` si besoin (`applyDockerSecretFiles`).

Postgres officiel : `POSTGRES_PASSWORD_FILE` natif.

---

## 4. Commandes

```bash
# Local infra
npm run docker:up
npm run docker:tools

# Staging
cp .env.staging.example .env.staging
npm run docker:secrets
npm run docker:staging
docker compose -f docker-compose.staging.yml exec -T app npx prisma migrate deploy

# Production
cp .env.production.example .env
npm run docker:secrets
npm run docker:prod
# ou
./scripts/deploy-docker.sh
```

HA workers :

```bash
WORKER_REPLICAS=3 npm run docker:prod
```

---

## 5. Healthchecks

| Service | Check |
|---|---|
| postgres | `pg_isready` |
| redis | `PING` |
| app (image) | `GET /api/health/live` |
| app (compose) | `GET /api/health/ready` |
| worker | `scripts/docker-worker-healthcheck.mjs` (heartbeat Redis) |

---

## 6. Volumes

| Volume | Usage |
|---|---|
| `postgres_data` / `staging_postgres_data` | PG data |
| `redis_data` / `staging_redis_data` | AOF |
| `app_logs` / `worker_logs` | `LOG_TO_FILE` |
| `*_tmp` | imports temporaires |

---

## 7. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Compose séparés | Prod ≠ staging ≠ local | Scripts `docker:prod` / `docker:staging` | Habitude `--profile production` | Alias npm mis à jour |
| Secrets fichiers | Pas de secrets dans env/image | Fichiers `./secrets` requis | Oubli → container refuse de démarrer | `env_file` .env encore possible en secours |
| Worker omit=dev | Image plus légère | Build worker plus long (2 installs) | Manque dep runtime | Revenir à `npm ci` full |
| Health ready | Orchestration fiable | depends_on healthy | App lente au boot | Allonger `start_period` |

---

## 8. Validation

- `tests/unit/docker-secrets.test.ts`
- `docker compose -f docker-compose.production.yml config`
- Build : `docker build -f Dockerfile --target app .`
- Build worker : `docker build -f Dockerfile.worker .`
