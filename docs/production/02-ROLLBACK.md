# Guide Rollback

Objectif : revenir à un état sain **sans** envoi SMTP incontrôlé.

---

## 1. Décider le type de rollback

| Symptôme | Action |
|---|---|
| Bug UI / API après deploy | Rollback **image / tag** |
| Migration destructrice / data corrompue | Rollback **données** (restore) |
| Spam / bounce storm / SMTP compromis | **Kill switch envoi** immédiat |
| Secret fuité | Rotation + éventuel rollback config |

---

## 2. Kill switch envoi (priorité #1)

Exécuter **en parallèle** si risque d’envoi :

1. `.env` (ou secrets) :
   ```env
   PRODUCTION_SENDING_ENABLED=false
   DRY_RUN=true
   ```
2. Redémarrer `app` + `worker`
3. Pause toutes les campagnes RUNNING (UI ou API)
4. Vérifier files BullMQ (`waiting` / `active` ↓) sur `/ops/monitoring`

---

## 3. Rollback image (CI / GHCR)

Workflow GitHub Actions `Rollback` :

1. Actions → **Rollback** → Run workflow
2. `environment` = `production` (ou `staging`)
3. `target_tag` = `vX.Y.Z` antérieur connu bon
4. `confirm` = `rollback`

Effet : retag des images `app` / `worker` de l’environnement vers le digeste du tag cible.

Ensuite sur l’hôte :

```bash
cd /opt/botoschool
# pull nouvelles tags d’env
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
curl -fsS "$APP_URL/api/health/ready"
```

> Les migrations Prisma sont **forward-only**. Si la release N a appliqué une migration incompatible avec le code N-1, il faut **restore DB** au snapshot pré-release (voir [08-RESTORE.md](./08-RESTORE.md)), pas seulement retaguer l’image.

---

## 4. Rollback Compose local (sans GHCR)

```bash
git checkout vX.Y.Z-previous
docker compose -f docker-compose.production.yml up -d --build
# Si migrations incompatibles : restore postgres avant up
```

---

## 5. Rollback données

1. Identifier `backup-id` pré-incident : `ls backups/`
2. `npm run backup:verify -- <backup-id>`
3. Maintenance courte : arrêter workers (éviter writes)
4. Restore ([08-RESTORE.md](./08-RESTORE.md))
5. Remonter app/worker sur le **même** tag code que le backup
6. Health + login + `/ops`

---

## 6. Rollback config / secrets

| Cas | Procédure |
|---|---|
| Mauvais SMTP | Restaurer anciens `SMTP_*` + allowlist ; redémarrer |
| AUTH_SECRET | Voir [SECRET-ROTATION](../runbooks/SECRET-ROTATION.md) § Rollback |
| Feature flags | Remettre `DRY_RUN=true`, quotas bas |

---

## 7. Communication

1. Statut incident (canal ops)
2. Impact utilisateurs (login / campagnes / envois)
3. ETA et type de rollback choisi
4. Post-mortem court dans [03-INCIDENT.md](./03-INCIDENT.md) § Journal

---

## 8. Critères de sortie

- [ ] Health ready OK
- [ ] Envoi réel désactivé **ou** quotas contrôlés + validation métier
- [ ] DLQ / erreurs stables
- [ ] Pas de divergence schéma / code
- [ ] Backup post-stabilisation créé
