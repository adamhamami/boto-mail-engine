# Phase 10 — Sauvegarde

Objectif : backup PostgreSQL + Redis + Uploads, restore, vérification automatique
et rotation — sans casser le runtime applicatif.

---

## 1. Livrables

| Élément | Emplacement |
|---|---|
| CLI | `scripts/backup/cli.mjs` |
| Backup / Restore / Verify / Rotate | `scripts/backup/*.mjs` |
| Planification host | `scripts/backup/schedule.sh` / `.ps1` |
| Stockage | `./backups/<timestamp>/` (gitignored) |
| Env | `BACKUP_*`, `IMPORT_TMP_DIR` |

---

## 2. Contenu d’un snapshot

```
backups/2026-08-01T05-45-00-000Z/
  manifest.json      # métadonnées + sha256
  VERIFY.json        # résultat auto-verify
  postgres.dump      # pg_dump -Fc
  redis/dump.rdb
  redis/appendonly.aof
  uploads/imports/   # ou EMPTY.txt
```

| Composant | Méthode | Priorité |
|---|---|---|
| PostgreSQL | `pg_dump -Fc` via `docker compose exec` | **Source de vérité** |
| Redis | `BGSAVE` + copy `/data` | Queues / rate-limit (secondaire) |
| Uploads | `.tmp/imports` host + tar container | Éphémère (imports en cours) |

---

## 3. Commandes

```bash
# Infra locale
npm run docker:up
npm run backup -- --compose=docker-compose.yml

# Production
npm run backup -- --compose=docker-compose.production.yml
npm run backup:verify
npm run backup:rotate

# Backup + rotation
npm run backup:all -- --compose=docker-compose.production.yml

# Restore (destructif)
npm run backup:restore -- <backup-id> --confirm=restore \
  --compose=docker-compose.production.yml \
  --components=postgres,redis,uploads
```

Windows :

```powershell
.\scripts\backup\schedule.ps1 -Target production
```

Cron Linux :

```cron
0 2 * * * /opt/botoschool/scripts/backup/schedule.sh production >> /var/log/botoschool-backup.log 2>&1
```

---

## 4. Vérification automatique

Après chaque backup :

1. Présence `manifest.json` / `postgres.dump` / `uploads/`
2. Checksums SHA-256
3. `pg_restore -l` (local ou `postgres:16-alpine`)
4. Artefacts Redis non vides
5. Écriture `VERIFY.json` — échec ⇒ exit ≠ 0

---

## 5. Rotation

| Variable | Défaut | Effet |
|---|---|---|
| `BACKUP_RETENTION_COUNT` | 30 | Garde les N plus récents |
| `BACKUP_RETENTION_DAYS` | 14 | Supprime au-delà de N jours |

Un backup est supprimé s’il dépasse **l’âge** ou le **quota de count**.

---

## 6. Restore — garde-fous

- Obligatoire : `--confirm=restore`
- Verify avant restore
- Postgres : `DROP SCHEMA public CASCADE` puis `pg_restore`
- Redis : stop → copy RDB/AOF → start → `PING`
- Post-check : `count(*)` tables `public` ≥ 1

**Toujours tester le restore sur staging avant la prod.**

---

## 7. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Scripts backup | Aucune automation avant | Dumps locaux `./backups` | Disk plein | `backup:rotate` + monitoring disk |
| Verify auto | Détecter dumps corrompus | Backup échoue si TOC KO | Docker pull `postgres:16-alpine` | `strict:false` soft TOC |
| Restore destructif | Reprise incident | Perte données post-backup | Confirmation explicite | Restaurer snapshot plus récent |
| Uploads best-effort | Imports mid-flight | Peut être vide | Faible | N/A (éphémère) |

---

## 8. Validation

```bash
npm run test -- tests/unit/backup-phase10.test.ts
npm run backup -- --compose=docker-compose.yml
npm run backup:verify
```
