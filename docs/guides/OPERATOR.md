# Guide opérateur — BotoSchool Email Platform

Public : ops / SRE / on-call. Objectif : **détecter, diagnostiquer, contenir** rapidement.

Complète le runbook production : [production/09-RUNBOOK.md](../production/09-RUNBOOK.md).

---

## 1. Carte des surfaces

| Surface | URL / commande | Auth |
|---|---|---|
| Liveness | `GET /api/health/live` | Public |
| Readiness | `GET /api/health/ready` | Public |
| Santé ops | `/ops` | `ops:read` |
| Monitoring | `/ops/monitoring` | `ops:read` |
| SMTP | `/ops/smtp` | `ops:read` / test `settings:write` |
| DNS | `/ops/dns` | idem |
| Métriques Prom | `/api/ops/metrics?format=prometheus` | session **ou** Bearer `METRICS_SCRAPE_TOKEN` |
| Grafana | `:3010` (profile monitoring) | admin Grafana |
| Prometheus | `:9090` | réseau interne |

Ancres UI monitoring : `#alertes` `#erreurs` `#workers` `#smtp`.

---

## 2. « Que se passe-t-il ? » en 2 minutes

```mermaid
flowchart TD
  A[Alerte / plainte métier] --> B{ready OK?}
  B -->|non| C[DB ou Redis — compose logs]
  B -->|oui| D{Worker up?}
  D -->|non| E[Restart worker + heartbeat]
  D -->|oui| F{DLQ / failure / bounce?}
  F -->|DLQ| G[Inspecter jobs email-dlq]
  F -->|SMTP| H[/ops/smtp + allowlist]
  F -->|DNS| I[/ops/dns]
  F -->|OK mais pas de mails| J[Gates DRY_RUN / PRODUCTION_SENDING]
```

### Signaux critiques

| Signal | Action immédiate |
|---|---|
| `ready` down | Page ; restart postgres/redis/app |
| Worker stale | `docker compose … restart worker` ; logs OOM |
| DLQ > 0 | Pause campagnes si massif ; rejouer / analyser |
| Bounce / failure élevés | Pause auto possible ; contenu / DNS / list |
| SMTP unhealthy | Kill switch gates ; [05-SMTP.md](../production/05-SMTP.md) |

---

## 3. Gates d’envoi (kill switch)

```bash
# Contenir immédiatement (exemple Docker / env)
PRODUCTION_SENDING_ENABLED=false
DRY_RUN=true
# Redémarrer app + worker
# Puis pause campagnes RUNNING + révoquer clé ESP si fuite
```

Ordre complet : [05-SMTP.md](../production/05-SMTP.md) §6 · [03-INCIDENT.md](../production/03-INCIDENT.md).

Ordre de bascule **vers** réel : checklist [00-CHECKLIST.md](../production/00-CHECKLIST.md) — jamais l’inverse sans validation.  
Rampe volumes **obligatoire** : [12-PRODUCTION-CONTROLEE.md](../production/12-PRODUCTION-CONTROLEE.md) (`10→50→100→500→1000→progressif`) · `npm run ramp:checklist`.
---

## 4. Stack monitoring

```bash
npm run docker:monitoring
# Aligner METRICS_SCRAPE_TOKEN (.env) = monitoring/prometheus/scrape_token
```

Dashboards Grafana (folder BotoSchool) : **Erreurs**, **Workers**, **SMTP**.  
Alertmanager : rules dans `monitoring/prometheus/alerts.yml`.  
Webhook in-app optionnel : `ALERT_WEBHOOK_URL`.

Détail : [28-ETAPE-5-OBSERVABILITE.md](../implementation/28-ETAPE-5-OBSERVABILITE.md) · [04-MONITORING.md](../production/04-MONITORING.md).

---

## 5. Logs & corrélation

Logs JSON (prod) portent :

- `correlationId`, `requestId`, `traceId`, `spanId`
- `campaignId`, `jobId` (workers)

Rechercher un incident :

1. Timestamp + `campaignId` dans `/audit` ou logs.
2. Suivre `correlationId` API → worker.
3. Vérifier `SendAttempt` / `Event` en base (Prisma Studio ou SQL).

---

## 6. Déploiement & rollback

| Action | Doc |
|---|---|
| Install | [01-INSTALLATION.md](../production/01-INSTALLATION.md) |
| Rollback | [02-ROLLBACK.md](../production/02-ROLLBACK.md) |
| Incident | [03-INCIDENT.md](../production/03-INCIDENT.md) |
| Backup / restore | [07-BACKUP.md](../production/07-BACKUP.md) · [08-RESTORE.md](../production/08-RESTORE.md) |
| Rotation secrets | [SECRET-ROTATION.md](../runbooks/SECRET-ROTATION.md) |

Santé post-deploy :

```bash
curl -fsS "$APP_URL/api/health/live"
curl -fsS "$APP_URL/api/health/ready"
# UI /ops/monitoring — worker up, DLQ 0, pas d’alerte critique
```

---

## 7. Docker permissions (rappel)

Prod/staging : containers app/worker `read_only`, `cap_drop: ALL`, `no-new-privileges`, USER non-root.  
Secrets via `*_FILE` sous `/run/secrets`.

---

## 8. Voir aussi

- [ADMIN.md](./ADMIN.md) — métier / RBAC
- [DEVELOPER.md](./DEVELOPER.md) — debug code
- [Architecture.md](../Architecture.md) — séquence d’envoi
- [production/README.md](../production/README.md) — index ops
