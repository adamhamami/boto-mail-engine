# Runbook opérations

Procédures récurrentes et actions standards. Pour crises → [03-INCIDENT.md](./03-INCIDENT.md).

---

## 1. Quotidien (5–10 min)

- [ ] `GET /api/health/ready` OK
- [ ] `/ops/monitoring` : DLQ = 0, worker heartbeat frais
- [ ] Pas d’alerte bounce / failure au-dessus seuil
- [ ] Dernier backup < 24 h (`ls -lt backups | head`)
- [ ] Espace disque OK

Si envoi réel actif :

- [ ] Quotas / volume du jour cohérents
- [ ] Spot-check logs worker (erreurs SMTP)

---

## 2. Hebdomadaire

- [ ] `/ops/smtp` + `/ops/dns` (WARNING → ticket)
- [ ] Revue DLQ / failed jobs (échantillon)
- [ ] `npm run backup:verify` sur le dernier snapshot
- [ ] Contrôle rétention (`backup:rotate` déjà dans cron ?)
- [ ] Revue comptes utilisateurs / désactivations

---

## 3. Mensuel

- [ ] Exercice restore **staging** ([08-RESTORE.md](./08-RESTORE.md))
- [ ] `npm run audit:ci` / revue dépendances
- [ ] Rotation SMTP password (si politique)
- [ ] Revue DMARC reports
- [ ] Vérifier tags GHCR / backups offsite

---

## 4. Déploiement release

1. Backup prod
2. Déployer tag `vX.Y.Z` (CI Release ou Compose)
3. `prisma migrate deploy`
4. Health + smoke login + `/ops`
5. Observer monitoring 30 min
6. Si KO → [02-ROLLBACK.md](./02-ROLLBACK.md)

---

## 5. Actions standards

### Redémarrer worker

```bash
docker compose -f docker-compose.production.yml restart worker
```

### Pause globale envoi

```env
PRODUCTION_SENDING_ENABLED=false
# redémarrer app + worker
```

+ Pause campagnes RUNNING dans l’UI.

### Purge prudente files (après analyse)

Ne pas supprimer DLQ sans export/analyse. Préférer corriger la cause puis retry manuel ciblé.

### Changer mot de passe admin

```bash
docker compose -f docker-compose.production.yml exec -T app \
  npx tsx scripts/change-admin-password.ts "NouveauMotDePasseFort!"
```

### Rotation AUTH_SECRET

[`../runbooks/SECRET-ROTATION.md`](../runbooks/SECRET-ROTATION.md)

---

## 6. Escalade

| Situation | Escalader vers |
|---|---|
| P1 envoi / data | Ops + Produit + Sécurité |
| ESP / réputation | Contact ESP + DNS owner |
| Fuite secret | Sécurité (révocation immédiate) |
| Bug applicatif | Dev (tag + logs correlationId) |

RACI à remplir dans [README.md](./README.md).

---

## 7. Références rapides

| Besoin | Doc |
|---|---|
| Install | [01-INSTALLATION.md](./01-INSTALLATION.md) |
| Rollback | [02-ROLLBACK.md](./02-ROLLBACK.md) |
| Monitoring | [04-MONITORING.md](./04-MONITORING.md) |
| SMTP / DNS | [05](./05-SMTP.md) / [06](./06-DNS.md) |
| Backup / Restore | [07](./07-BACKUP.md) / [08](./08-RESTORE.md) |
| Checklist GO | [00-CHECKLIST.md](./00-CHECKLIST.md) |
