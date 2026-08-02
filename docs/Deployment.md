# Déploiement — BotoSchool Email Platform

> **Ops production (Phase 12)** : pack complet dans [`docs/production/`](./production/README.md)
> (installation, rollback, incident, monitoring, SMTP, DNS, backup, restore, runbook, checklist).

## Checklist avant prod

Suivre aussi [`docs/production/00-CHECKLIST.md`](./production/00-CHECKLIST.md).

1. `npm run secrets:generate` → secrets dans `.credentials.local`
2. Copier `.env.production.example` → `.env` et remplir
3. Configurer SMTP réel (ou Mailpit en staging)
4. `npm run admin:password "MotDePasseFort"`
5. Déployer Docker **ou** Vercel + worker séparé
6. `prisma migrate deploy` + seed une seule fois
7. Vérifier `GET /api/health/live` et `GET /api/health/ready`

---

## Développement local (recommandé)

```bash
# Infra
npm run docker:up
npm run docker:tools          # Mailpit SMTP (UI :808025)

# DB
npx prisma migrate deploy
npm run db:seed
npm run admin:password "VotreMotDePasseFort12"

# App + worker (2 terminaux)
npm run dev
npm run worker
```

- App : http://localhost:3000  
- Mailpit : http://localhost:8025  
- Secrets locaux : `.credentials.local` (gitignored)

### SMTP réel (quand prêt)

Dans `.env` :

```env
SMTP_HOST=smtp.votre-fournisseur.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM_EMAIL=noreply@votredomaine.com
```

Tester via **Paramètres → Tester SMTP**.

---

## Sécurité dépendances (Phase 9)

Voir [`docs/implementation/18-PHASE-9-DEPENDENCY-SECURITY.md`](./implementation/18-PHASE-9-DEPENDENCY-SECURITY.md).

```bash
npm audit              # 0 vulnérabilités attendu
npm run audit:ci
npm run deps:outdated
```

---

## CI/CD (Phase 8)

Voir [`docs/implementation/17-PHASE-8-CICD.md`](./implementation/17-PHASE-8-CICD.md).

| Workflow | Rôle |
|----------|------|
| `CI` | lint, typecheck, prisma, tests, coverage, audit, docker build/scan |
| `Release` | tag `v*.*.*` → GHCR + GitHub Release |
| `Rollback` | retag `staging`/`production` vers un tag antérieur |

```bash
git tag v1.0.0 && git push origin v1.0.0
```

---

## Chemin A — Docker Compose (Phase 7)

Voir aussi [`docs/implementation/16-PHASE-7-DOCKER.md`](./implementation/16-PHASE-7-DOCKER.md).

### Prérequis

- Docker Desktop / Docker Engine
- `.env` (prod) ou `.env.staging` (staging)
- Secrets fichiers : `npm run docker:secrets`

### Production

```bash
cp .env.production.example .env
# Renseigner APP_URL, SMTP_*, etc. (pas forcément les secrets)
npm run docker:secrets
npm run deploy:docker          # ou npm run docker:prod
# HA :
# WORKER_REPLICAS=3 npm run docker:prod
```

Windows : `npm run deploy:docker` → `scripts/deploy-docker.ps1`

### Staging (Mailpit + DRY_RUN)

```bash
cp .env.staging.example .env.staging
npm run docker:secrets
npm run deploy:staging          # build + migrate + seed + ready
npm run smoke:staging           # health + worker restart + scénarios
```

Guide complet : [`production/11-STAGING.md`](./production/11-STAGING.md).

- App staging : http://localhost:3001  
- Mailpit UI : http://localhost:8026  

### Services

| Service | Prod | Staging |
|---------|------|---------|
| `app` | `:3000` | `:3001` |
| `worker` | scale N | 1 |
| `postgres` | internal only | `:5434` |
| `redis` | internal only | `:6380` |
| `mailpit` | — | `:8026` UI |

Secrets montés : `./secrets/*.txt` → `/run/secrets/*` (`*_FILE`).

Après premier deploy :

```bash
docker compose -f docker-compose.production.yml exec app npx prisma db seed
# ou seed via image qui contient tsx — sinon depuis la machine hôte pointant DATABASE_URL
```

---

## Chemin B — Vercel (web) + worker séparé

> Les workers BullMQ **ne tournent pas** sur Vercel serverless.

| Composant | Hébergement |
|-----------|-------------|
| Next.js | Vercel |
| PostgreSQL | Neon / Supabase / Prisma Postgres |
| Redis | Upstash / Redis Cloud |
| Worker | VPS / Railway / Fly / Docker |

### Vercel

```bash
npx vercel link
npx vercel env pull   # ou configurer dans le dashboard
npx vercel --prod
```

Variables obligatoires sur Vercel : `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `AUTH_URL`, `APP_URL`, `SMTP_*`.

Migrations (CI ou local vers DB prod) :

```bash
npx prisma migrate deploy
npm run db:seed
npm run admin:password "..."
```

### Worker (machine séparée)

```bash
git clone <repo> && cd hassan
npm ci
# même .env que Vercel (DATABASE_URL, REDIS_URL, SMTP_*)
npx prisma generate
npm run worker
```

Sans worker → aucune campagne n’envoie réellement.

---

## Secrets

```bash
npm run secrets:generate   # écrit .credentials.local
npm run admin:password "NouveauMotDePasseFort"
```

Génération manuelle :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Health & monitoring

```
GET /api/health/live
GET /api/health/ready
```

Guides : [`production/04-MONITORING.md`](./production/04-MONITORING.md).

---

## Backups (Phase 10)

Voir [`production/07-BACKUP.md`](./production/07-BACKUP.md) et
[`docs/implementation/19-PHASE-10-BACKUP.md`](./implementation/19-PHASE-10-BACKUP.md).

```bash
npm run docker:up
npm run backup -- --compose=docker-compose.yml
npm run backup:verify
npm run backup:rotate

# Production
npm run backup:all -- --compose=docker-compose.production.yml

# Restore (destructif)
npm run backup:restore -- <backup-id> --confirm=restore --compose=docker-compose.production.yml
```

Planification : `scripts/backup/schedule.sh production` (cron) ou `schedule.ps1` (Task Scheduler).

---

## Sécurité prod

- [ ] `AUTH_SECRET` fort unique
- [ ] Mot de passe admin ≠ seed par défaut
- [ ] SMTP credentials hors Git
- [ ] HTTPS (reverse proxy)
- [ ] Postgres/Redis non exposés publiquement
- [ ] Backups automatisés
