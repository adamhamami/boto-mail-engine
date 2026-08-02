# Guide Monitoring

Surfaces : UI `/ops`, `/ops/monitoring`, health publics, logs structurés,
stack Prometheus/Grafana (`docs/implementation/28-ETAPE-5-OBSERVABILITE.md`).

---

## 1. Endpoints santé

| Endpoint | Auth | Rôle |
|---|---|---|
| `GET /api/health/live` | Public | Process vivant (LB) |
| `GET /api/health/ready` | Public | DB + Redis joignables |
| UI `/ops/*` | Session + `ops:read` | Détail ops |

Sondes recommandées (Uptime / reverse-proxy) :

- Live toutes les 15–30 s
- Ready toutes les 30–60 s (alerte si 2 échecs)

---

## 2. UI Monitoring

`/ops/monitoring` agrège (fenêtre `MONITORING_METRICS_WINDOW_MINUTES`) :

- Files BullMQ : waiting / active / delayed / failed / DLQ
- Heartbeat workers
- Taux bounce / failure / retries
- CPU / RAM process (seuils `ALERT_*`)

| Variable | Défaut | Sens |
|---|---|---|
| `ALERT_DLQ_MAX` | 0 | Toute DLQ = alerte |
| `ALERT_QUEUE_WAITING_MAX` | 500 | Embouteillage |
| `ALERT_BOUNCE_RATE_MAX` | 0.05 | 5 % |
| `ALERT_FAILURE_RATE_MAX` | 0.1 | 10 % |
| `ALERT_RETRIES_MAX` | 50 | Retries récents |
| `ALERT_WORKER_STALE_MS` | 60000 | Worker muet |
| `ALERT_CPU_PERCENT_MAX` | 90 | |
| `ALERT_RAM_PERCENT_MAX` | 90 | |

---

## 3. Autres vues ops

| Page | Contenu |
|---|---|
| `/ops` | Vue santé globale |
| `/ops/smtp` | Probe SMTP / TLS / allowlist |
| `/ops/dns` | SPF / DKIM / DMARC / MX / rDNS |
| Dashboard | KPIs métier (cache Redis court) |

---

## 4. Logs

- Prod : `LOG_LEVEL=info`, `LOG_JSON=true` → stdout Docker
- Corrélation : `correlationId` / `requestId` (audit enrichi)
- Secrets : jamais logger mots de passe / SMTP_PASSWORD / tokens

Collecte typique : Docker logging driver → Loki / CloudWatch / ELK.

Stack métriques locale : `npm run docker:monitoring` (Prometheus :9090, Grafana :3010).
Scrape : `GET /api/ops/metrics?format=prometheus` + `METRICS_SCRAPE_TOKEN`.

Option fichiers :

```env
LOG_TO_FILE=true
LOG_DIR=/var/log/botoschool
LOG_COMPRESS=true
```

---

## 5. Queues & Redis

Surveiller :

- Croissance `waiting` sans baisse `completed`
- `failed` / DLQ
- Mémoire Redis (rétention jobs Phase 11 bornée)
- Latence `PING`

Heartbeats : `WORKER_HEARTBEAT_INTERVAL_MS` (défaut 15 s).

---

## 6. Alerting opérationnel

| Signal | Action immédiate |
|---|---|
| ready down | Page ops ; restart stack |
| Worker stale | Restart worker ; logs OOM |
| DLQ > 0 | Inspecter jobs ; pause campagnes si massif |
| Bounce > seuil | Pause + [06-DNS.md](./06-DNS.md) / contenu |
| SMTP probe fail | [05-SMTP.md](./05-SMTP.md) ; kill switch si persistant |

---

## 7. Routine

Voir [09-RUNBOOK.md](./09-RUNBOOK.md) § Quotidien / Hebdomadaire.
