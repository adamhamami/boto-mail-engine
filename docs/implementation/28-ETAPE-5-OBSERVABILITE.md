# Étape 5 — Observabilité (Prometheus / Grafana / traces / alertes)

Objectif : **comprendre immédiatement** lorsqu’un problème survient —
en complément du monitoring in-app (`/ops/monitoring`).

---

## 1. Synthèse

| Capacité | In-app | Stack Docker `monitoring` |
|---|---|---|
| Métriques Prometheus | `/api/ops/metrics?format=prometheus` | Prometheus scrape |
| Alertes | Règles `evaluateMonitoringAlerts` + UI | Alertmanager + rules Prom |
| Dashboards erreurs / workers / SMTP | Ancres `#erreurs` `#workers` `#smtp` | Grafana provisionné |
| Traces | W3C `traceparent` + `withTracedSpan` (logs) | Corrélation via `traceId` JSON |
| Webhook | `ALERT_WEBHOOK_URL` (changement de set) | Alertmanager webhook |

---

## 2. Auth scrape (sécurité)

- **Session** `ops:read` (UI / curl cookie)
- **OU** `Authorization: Bearer ${METRICS_SCRAPE_TOKEN}`
- Jamais public anonyme ; middleware laisse passer Bearer → validation route

Aligner :

```bash
# .env
METRICS_SCRAPE_TOKEN=<secret>
OBSERVABILITY_GRAFANA_URL=http://localhost:3010

# monitoring/prometheus/scrape_token (même valeur)
npm run docker:monitoring
```

---

## 3. Démarrage local

```bash
# App + worker déjà up sur :3000
npm run docker:monitoring
# Prometheus :9090 · Alertmanager :9093 · Grafana :3010 (admin/admin)
```

Dashboards Grafana (folder BotoSchool) :

- **Erreurs** — failure/bounce/DLQ/retries
- **Workers** — heartbeat, instances, queues
- **SMTP** — up / DRY_RUN / débit / rates

---

## 4. Métriques ajoutées (Étape 5)

`botoschool_db_up`, `botoschool_status`, `botoschool_email_events{type}`,
`botoschool_alert{id,severity}`, `botoschool_worker_instances`,
`botoschool_worker_enabled`, `botoschool_smtp_up`, `botoschool_smtp_dry_run`

---

## 5. Traces

- Headers / logs : `traceId`, `spanId`, `correlationId` (Phase 5)
- Helper : `withTracedSpan(name, fn)` → logs `trace.start|end|error`
- Pas de SDK OTel (volontaire) — export OTLP possible plus tard sans casser les IDs

---

## 6. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Scrape token | Prometheus sans cookie session | Scraping ops | Token faible | Vider `METRICS_SCRAPE_TOKEN` |
| Grafana profile | Visibilité temps réel | MTTD ↓ | Ports locaux | `docker compose --profile monitoring down` |
| Alert webhook | Canal externe | Push immédiat | Spam si URL KO | Vider `ALERT_WEBHOOK_URL` |
| Prom series + | Alertmanager / Grafana | Panels utiles | Cardinalité faible | — |

---

## 7. Commandes

```bash
npm run typecheck
npx vitest run tests/unit/monitoring-phase4.test.ts
npm run docker:monitoring
curl -H "Authorization: Bearer $METRICS_SCRAPE_TOKEN" \
  "http://127.0.0.1:3000/api/ops/metrics?format=prometheus"
```

---

## 8. Fichiers clés

- `src/lib/monitoring/prometheus.ts`, `metrics-auth.ts`, `alert-webhook.ts`
- `src/lib/observability/traced-span.ts`
- `monitoring/prometheus/*`, `monitoring/grafana/*`, `monitoring/alertmanager/*`
- `docker-compose.yml` profile `monitoring`
- UI : `src/app/(dashboard)/ops/monitoring/monitoring-client.tsx`
