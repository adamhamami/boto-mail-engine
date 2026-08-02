# Guide Backup

Automatiser et vérifier les sauvegardes Postgres + Redis + uploads.

Réf. technique : [`../implementation/19-PHASE-10-BACKUP.md`](../implementation/19-PHASE-10-BACKUP.md).

---

## 1. Contenu d’un snapshot

```
backups/<backup-id>/
  manifest.json
  VERIFY.json
  postgres.dump      # source de vérité
  redis/…
  uploads/…
```

---

## 2. Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `BACKUP_DIR` | `backups` | Répertoire hôte |
| `BACKUP_COMPOSE_FILE` | `docker-compose.production.yml` | Compose cible |
| `BACKUP_RETENTION_DAYS` | 14 | Âge max |
| `BACKUP_RETENTION_COUNT` | 30 | Nombre max |
| `IMPORT_TMP_DIR` | `.tmp/imports` | Uploads |

---

## 3. Commandes

```bash
cd /opt/botoschool

# Snapshot + verify implicite
npm run backup -- --compose=docker-compose.production.yml

# Verify explicite
npm run backup:verify

# Rotation
npm run backup:rotate

# Enchaînement (cron)
npm run backup:all -- --compose=docker-compose.production.yml
```

---

## 4. Planification

**Linux**

```cron
0 2 * * * /opt/botoschool/scripts/backup/schedule.sh production \
  >> /var/log/botoschool-backup.log 2>&1
```

**Windows**

Task Scheduler → `scripts/backup/schedule.ps1 -Target production` (quotidien 02:00).

---

## 5. Vérifications

Après chaque run :

- [ ] Exit code 0
- [ ] `VERIFY.json` présent / OK
- [ ] Taille `postgres.dump` plausible
- [ ] Espace disque restant (> 20 %)
- [ ] Copie offsite (recommandé : rsync / S3 / NAS)

```bash
# Contrôle manuel TOC
npm run backup:verify -- <backup-id>
```

---

## 6. Bonnes pratiques

- Backup **immédiat** avant release, bascule SMTP, restore test
- Conserver au moins 1 snapshot hors machine
- Ne jamais committer `backups/`
- Alerter si le job cron n’a pas tourné (âge du dernier dossier)

---

## 7. Restore

Procédure destructrice séparée : [08-RESTORE.md](./08-RESTORE.md).
