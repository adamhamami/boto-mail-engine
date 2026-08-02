# Guide Restore

Restauration **destructive**. Toujours tester sur staging avant la prod.

---

## 1. Prérequis

- [ ] `backup-id` identifié (`ls backups/`)
- [ ] `npm run backup:verify -- <backup-id>` OK
- [ ] GO écrit (P1 data / rollback migration)
- [ ] Fenêtre de maintenance communiquée
- [ ] Tag applicatif compatible avec le schéma du snapshot

---

## 2. Préparer

```bash
cd /opt/botoschool

# Kill switch envoi
# PRODUCTION_SENDING_ENABLED=false  DRY_RUN=true

# Stop workers (évite writes pendant restore)
docker compose -f docker-compose.production.yml stop worker app
```

Optionnel : snapshot « dernier recours » de l’état courant **avant** restore (si DB encore lisible).

---

## 3. Exécuter

```bash
npm run backup:restore -- <backup-id> \
  --confirm=restore \
  --compose=docker-compose.production.yml \
  --components=postgres,redis,uploads
```

Sans `--confirm=restore` → refus.

Composants :

| Composant | Effet |
|---|---|
| `postgres` | `DROP SCHEMA public` + `pg_restore` |
| `redis` | Remplace RDB/AOF (queues / cache) |
| `uploads` | Restaure `.tmp/imports` si présent |

---

## 4. Remonter

```bash
# Même tag code que le backup
docker compose -f docker-compose.production.yml up -d

curl -fsS "$APP_URL/api/health/ready"

# Smoke
# - login admin
# - /ops queues
# - compter campagnes / contacts (échantillon)
```

Si migrations manquantes vs code plus récent :

```bash
docker compose -f docker-compose.production.yml exec -T app \
  npx prisma migrate deploy
```

---

## 5. Post-restore

- [ ] Health ready OK
- [ ] Envoi réel **reste** désactivé jusqu’à GO métier
- [ ] Réconcilier files BullMQ (jobs obsolètes possibles)
- [ ] Nouveau backup `backup:all` de l’état restauré
- [ ] Journal incident mis à jour

---

## 6. Pièges

| Piège | Mitigation |
|---|---|
| Code plus neuf que DB | Retag image alignée OU migrate deploy contrôlé |
| Redis restauré = anciennes jobs | Purger files / redémarrer workers après revue |
| Mauvais backup-id | Verify + dry-run mental sur manifest.json |
| Oubli kill switch | Remettre gates avant up |

---

## 7. Staging (exercice obligatoire)

Au moins une fois par trimestre :

1. Restore du dernier backup prod **vers staging** (DB distincte)
2. Valider login + lecture campagnes
3. Documenter durée réelle → RTO
