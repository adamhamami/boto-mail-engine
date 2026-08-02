# Phase 4 — Monitoring

Objectif : exposer Health Check, Metrics, Readiness, Liveness, dashboards
BullMQ / Redis / SMTP / Worker, les métriques métier demandées, et des alertes
automatiques — sans casser `/api/health` (Docker) ni les pages ops existantes.

---

## 1. Endpoints

| Endpoint | Auth | Rôle |
|---|---|---|
| `GET /api/health` | public | Inchangé — DB + Redis (Docker healthcheck) |
| `GET /api/health/live` | public | **Liveness** — process up, aucune dépendance |
| `GET /api/health/ready` | public | **Readiness** — DB + Redis, 503 si KO |
| `GET /api/ops/monitoring` | `ops:read` | Rapport complet UI |
| `GET /api/ops/metrics` | `ops:read` | JSON metrics |
| `GET /api/ops/metrics?format=prometheus` | `ops:read` | OpenMetrics text |

**Pourquoi séparer live / ready** : utiliser `/api/health` comme liveness kube
tuerait le pod dès que Redis tombe (boucle de redémarrage). Live = process ;
Ready = dépendances.

---

## 2. Dashboards (`/ops/monitoring`)

- **Health Check** — DB / Redis + liens live/ready
- **BullMQ** — waiting / active / delayed / failed / completed par file
- **Redis** — version, mémoire, clients, ops/s, hit rate, rôle
- **SMTP** — provider, santé (dernier rapport Phase 2), lien `/ops/smtp`
- **Worker** — heartbeat Redis `ops:worker:heartbeat` écrit toutes les 15 s
  par le process worker

---

## 3. Métriques

| Métrique | Source |
|---|---|
| CPU | `os.loadavg()` / cœurs |
| RAM | `os.totalmem/freemem` + RSS process |
| Queue | BullMQ counts |
| Retries | `SendAttempt.attemptNumber > 1` (fenêtre) |
| DLQ | `email-dlq` waiting |
| Temps moyen | AVG(`sent_at - queued_at`) sur SENT |
| Emails envoyés | `EventType.EMAIL_SENT` (fenêtre + total) |
| Emails/min · /heure | dérivés de la fenêtre |
| Bounce / Open / Reply / Failure Rate | events / sendAttempts ÷ sent |

Fenêtre : `MONITORING_METRICS_WINDOW_MINUTES` (défaut 60).

> Open Rate reste 0 tant qu'aucun producteur `EMAIL_OPENED` n'est branché
> (enum déjà présente — pas inventée ici).

---

## 4. Alertes automatiques

Évaluées à chaque rapport (`evaluateMonitoringAlerts`) — pure, testable.

| Alerte | Sévérité | Seuil env |
|---|---|---|
| DB / Redis down | critical | — |
| Worker stale / absent | critical | `ALERT_WORKER_STALE_MS` |
| DLQ > max | critical | `ALERT_DLQ_MAX` (défaut 0) |
| Queue waiting | warning | `ALERT_QUEUE_WAITING_MAX` |
| Bounce rate | critical | `ALERT_BOUNCE_RATE_MAX` |
| Failure rate | warning | `ALERT_FAILURE_RATE_MAX` |
| Retries | warning | `ALERT_RETRIES_MAX` |
| CPU / RAM | warning | `ALERT_*_PERCENT_MAX` |
| SMTP unhealthy | critical | (hors DRY_RUN) |

V1 = alertes in-app (UI + métrique `botoschool_alerts_firing`). Pas de Slack /
PagerDuty — peut être branché plus tard sur le même moteur.

---

## 5. Impact / risques / rollback

- **Impact** : lecture seule (DB counts, Redis INFO, queues). Heartbeat worker
  écrit une clé Redis TTL 120 s — sans effet sur les jobs.
- **Risque** : charge DB si polling très agressif — UI rafraîchit toutes les 15 s
  pour les porteurs `ops:read` uniquement.
- **Rollback** : retirer `/ops/monitoring` du nav ; endpoints health live/ready
  sont additifs. `/api/health` inchangé.
- **Migration Prisma** : aucune.

---

## 6. Tests

`tests/unit/monitoring-phase4.test.ts` — système, règles d'alertes, export
Prometheus. Suite complète sans régression.
