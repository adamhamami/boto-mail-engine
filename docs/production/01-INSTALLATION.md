# Guide Installation — Production

Installation Docker Compose (chemin recommandé). Pour Vercel + worker séparé, voir [`../Deployment.md`](../Deployment.md) § Chemin B.

---

## 1. Prérequis

| Composant | Minimum |
|---|---|
| OS | Linux x86_64 (Ubuntu 22.04+) ou Windows Server + Docker |
| Docker | Engine 24+ / Compose v2 |
| Disque | ≥ 40 Go (app + Postgres + Redis + `backups/`) |
| RAM | ≥ 4 Go (8 Go recommandé avec workers) |
| Node (hôte) | 20+ pour scripts backup / secrets (optionnel si tout en container) |

---

## 2. Préparer le dépôt

```bash
git clone <repo-url> /opt/botoschool
cd /opt/botoschool
git checkout vX.Y.Z   # tag release, pas main non tagué

cp .env.production.example .env
```

Éditer `.env` :

1. `APP_URL` / `AUTH_URL` → URL HTTPS publique
2. `POSTGRES_PASSWORD` fort → même valeur dans `DATABASE_URL`
3. SMTP / DNS / alertes selon guides dédiés
4. **Laisser** `DRY_RUN=true` et `PRODUCTION_SENDING_ENABLED=false` au premier boot

---

## 3. Secrets

```bash
npm ci                 # si Node sur l’hôte
npm run secrets:generate
# Copier AUTH_SECRET / WEBHOOK_SECRET depuis .credentials.local → .env
# (ou fichiers secrets Docker)

npm run docker:secrets
# Produit ./secrets/*.txt montés en /run/secrets (*_FILE)
```

Ne jamais committer `.env`, `.credentials.local`, `secrets/`.

---

## 4. Premier déploiement

```bash
# Build + up
npm run deploy:docker
# équivalent : docker compose -f docker-compose.production.yml up -d --build

# Migrations
docker compose -f docker-compose.production.yml exec -T app \
  npx prisma migrate deploy

# Seed (une seule fois)
docker compose -f docker-compose.production.yml exec -T app \
  npx prisma db seed

# Mot de passe admin
docker compose -f docker-compose.production.yml exec -T app \
  npx tsx scripts/change-admin-password.ts "MotDePasseFort12!"
```

HA (optionnel) :

```bash
WORKER_REPLICAS=2 docker compose -f docker-compose.production.yml up -d --scale worker=2
```

---

## 5. Reverse proxy (exemple Caddy)

```caddy
email.botoschool.com {
  reverse_proxy localhost:3000
  encode gzip
}
```

Nginx : proxy_pass vers `127.0.0.1:3000`, headers `X-Forwarded-Proto` / `Host`, TLS via Let’s Encrypt.

---

## 6. Vérifications post-install

```bash
curl -fsS https://email.botoschool.com/api/health/live
curl -fsS https://email.botoschool.com/api/health/ready

docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=100 app worker
```

UI :

1. Login admin
2. `/ops` — queues / heartbeat
3. `/ops/smtp` — config (sans envoyer si DRY_RUN)
4. `/ops/dns` — enregistrements

---

## 7. Planification backup

```bash
# Linux cron (02:00)
0 2 * * * /opt/botoschool/scripts/backup/schedule.sh production \
  >> /var/log/botoschool-backup.log 2>&1
```

Windows : Task Scheduler → `scripts/backup/schedule.ps1 -Target production`.

Détails : [07-BACKUP.md](./07-BACKUP.md).

---

## 8. Mise à jour (release suivante)

1. Backup : `npm run backup:all -- --compose=docker-compose.production.yml`
2. `git fetch && git checkout vX.Y.Z+1`
3. Rebuild / pull images GHCR
4. `migrate deploy`
5. Health + smoke login
6. Si échec → [02-ROLLBACK.md](./02-ROLLBACK.md)

---

## 9. Rollback install

Si le premier boot échoue : `docker:down:prod`, corriger `.env`, relancer.
Ne pas activer SMTP réel tant que la checklist [00-CHECKLIST.md](./00-CHECKLIST.md) n’est pas signée.
