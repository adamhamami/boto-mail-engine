# README Production — BotoSchool Email Platform

Point d’entrée **ops / déploiement** pour la production (et staging aligné).

> Les envois SMTP réels restent sous gates CDC :
> `DRY_RUN` + `PRODUCTION_SENDING_ENABLED` — ne jamais les basculer sans checklist signée.

---

## Documents

| Guide | Fichier |
|---|---|
| Checklist Production | [00-CHECKLIST.md](./00-CHECKLIST.md) |
| Installation | [01-INSTALLATION.md](./01-INSTALLATION.md) |
| Rollback | [02-ROLLBACK.md](./02-ROLLBACK.md) |
| Incident | [03-INCIDENT.md](./03-INCIDENT.md) |
| Monitoring | [04-MONITORING.md](./04-MONITORING.md) |
| SMTP | [05-SMTP.md](./05-SMTP.md) |
| DNS | [06-DNS.md](./06-DNS.md) |
| Backup | [07-BACKUP.md](./07-BACKUP.md) |
| Restore | [08-RESTORE.md](./08-RESTORE.md) |
| Runbook ops | [09-RUNBOOK.md](./09-RUNBOOK.md) |
| Conformité CNDP | [10-CONFORMITE.md](./10-CONFORMITE.md) |
| Staging préprod | [11-STAGING.md](./11-STAGING.md) |
| Production contrôlée | [12-PRODUCTION-CONTROLEE.md](./12-PRODUCTION-CONTROLEE.md) |

Compléments :

- Documentation finale v1.0 : [`../FINAL.md`](../FINAL.md)
- Release notes : [`../releases/v1.0.0.md`](../releases/v1.0.0.md)
- Guides : [`../guides/README.md`](../guides/README.md) (dev / admin / ops)
- Architecture & séquence d’envoi : [`../Architecture.md`](../Architecture.md)
- Modèle de données : [`../Database.md`](../Database.md)
- DNS email (Étape 8) : [06-DNS.md](./06-DNS.md) · `npm run dns:checklist`
- SMTP réel (Étape 9) : [05-SMTP.md](./05-SMTP.md) · `npm run smtp:checklist`
- Rampe volume (Étape 10) : [12-PRODUCTION-CONTROLEE.md](./12-PRODUCTION-CONTROLEE.md) · `npm run ramp:checklist`
- Template env : [`.env.production.example`](../../.env.production.example)
- Déploiement technique : [`../Deployment.md`](../Deployment.md)
- Rotation secrets : [`../runbooks/SECRET-ROTATION.md`](../runbooks/SECRET-ROTATION.md)
- Phases implémentation : [`../implementation/`](../implementation/)
- Validation finale : [`../final-audit/PHASE-14-VALIDATION-REPORT.md`](../final-audit/PHASE-14-VALIDATION-REPORT.md) (`npm run validate:final`)

---

## Architecture cible (chemin A — recommandé)

```
Internet → Reverse proxy (TLS)
              ↓
         app (Next.js) × N
              ↓
    ┌─────────┴─────────┐
 postgres            redis
                         ↓
                   worker × N (BullMQ)
                         ↓
                      SMTP ESP
```

Workers **obligatoires** pour l’envoi. Sans worker → files qui grossissent, aucun mail.

---

## Gates d’envoi (non négociables)

| Variable | Sens sûr | Sens envoi réel |
|---|---|---|
| `DRY_RUN` | `true` | `false` |
| `PRODUCTION_SENDING_ENABLED` | `false` | `true` |
| `SMTP_HOST_ALLOWLIST` | — | hôte SMTP résolu |
| `ALLOW_TEST_SMTP` | `false` | `false` (sauf staging contrôlé) |

Ordre de bascule recommandé : staging Mailpit → staging SMTP allowlist → prod quotas bas → montée progressive.

---

## Commandes vitales

```bash
# Santé
curl -fsS "$APP_URL/api/health/live"
curl -fsS "$APP_URL/api/health/ready"

# Deploy Docker
cp .env.production.example .env
npm run secrets:generate && npm run docker:secrets
npm run deploy:docker   # ou docker:prod
docker compose -f docker-compose.production.yml exec -T app npx prisma migrate deploy

# Arrêt d’urgence envoi
# → PRODUCTION_SENDING_ENABLED=false (+ redémarrer app/worker)
# → pause campagnes RUNNING via UI / API
```

---

## Contacts & RACI (à remplir)

| Rôle | Nom | Canal |
|---|---|---|
| Owner produit | | |
| Ops / astreinte | | |
| Sécurité | | |
| ESP / DNS | | |
