# Phase 6 — Haute disponibilité

Objectif : plusieurs workers BullMQ, plusieurs instances API, Redis partagé,
zero duplicate, idempotence distribuée, leader election, graceful shutdown,
retry intelligent et backoff exponentiel — sans casser les gates CDC ni les
recettes.

---

## 1. Architecture HA

```
┌─────────────┐   ┌─────────────┐
│  API × N    │   │ Worker × N  │
│ (Next.js)   │   │ (BullMQ)    │
└──────┬──────┘   └──────┬──────┘
       │                 │
       └────────┬────────┘
                ▼
         ┌─────────────┐
         │ Redis partagé│  queues + locks + leaders + rate-limit + heartbeats
         └─────────────┘
                │
                ▼
         ┌─────────────┐
         │ PostgreSQL  │  unique idempotencyKey + claims atomiques
         └─────────────┘
```

| Composant | Mécanisme |
|---|---|
| Multi-worker | BullMQ consumers concurrents sur les mêmes queues |
| Multi-API | Enqueue idempotent (`jobId` = `idempotencyKey`) |
| Redis partagé | `REDIS_URL` unique (`getRedisConnection`) |
| Zero duplicate | Lock Redis + `updateMany` claim + garde `SENT` / `smtpAccepted` |
| Idempotence | `buildSendIdempotencyKey` + `@unique` + BullMQ `jobId` |
| Leader | `LeaderElector` Redis SET NX (scan campagnes) |
| Shutdown | `installGracefulShutdown` + `worker.close` + Redis/Prisma |
| Retry | `QuotaDeferredError` → `moveToDelayed` ; sinon backoff custom |
| Backoff | Exponentiel + jitter (`EMAIL_QUEUE_BACKOFF_*`) |

---

## 2. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Lock Redis `ha:lock:send:*` | Empêcher double SMTP multi-worker | Légère latence Redis avant send | Lock orphelin si crash (TTL) | `HA_SEND_LOCK_TTL_MS` / stub deps |
| Claim `updateMany` QUEUED\|FAILED\|PROCESSING | Zero-duplicate DB | Skip si statut terminal | Retry après crash PROCESSING OK (reclaim) | Revenir à `update` simple |
| Leader `campaign-scan` | Un seul registraire du repeatable | Moins de bruit Redis | Fenêtre sans leader ~TTL | `registerScanRepeatable: true` par worker |
| Heartbeat multi-instance | Ops voit N workers | Clés Redis `ops:worker:heartbeat:inst:*` | Aucun | Lire clé legacy |
| Rate-limit Redis | Cohérence multi-API | Login/API partagés | Fallback `insuranceLimiter` memory | `RATE_LIMIT_STORE=memory` |
| Backoff custom + jitter | Anti-thundering herd | Délais légèrement variables | Aucun fonctionnel | Jitter=0 |
| Compose sans `container_name` | `docker compose --scale worker=N` | Noms containers auto | Scripts hardcodés `botoschool-worker` | Remettre `container_name` |

---

## 3. Fichiers clés

| Fichier | Rôle |
|---|---|
| `src/lib/ha/distributed-lock.ts` | SET NX PX + release Lua |
| `src/lib/ha/leader-election.ts` | Leader election + renew |
| `src/lib/ha/graceful-shutdown.ts` | SIGTERM/SIGINT drain + timeout |
| `src/lib/queue/index.ts` | Backoff custom, `closeQueueInfrastructure` |
| `src/workers/process-email-send.ts` | Lock + claim atomique |
| `src/workers/email.worker.ts` | `QuotaDeferredError` → DelayedError |
| `src/workers/index.ts` | Leader scan + shutdown ordonné |
| `src/lib/api/rate-limit.ts` | Redis store multi-API |
| `src/lib/monitoring/worker-heartbeat.ts` | Heartbeats par instance |
| `docker-compose.yml` | Scale worker / rate-limit redis |

---

## 4. Déploiement multi-instance

```bash
# Workers HA (exemple 3 replicas)
docker compose --profile production up -d --scale worker=3

# API : une instance sur APP_PORT ; pour N APIs, placer un reverse-proxy
# devant des services `app` exposés en interne (même REDIS_URL / DATABASE_URL).
```

Variables :

| Variable | Défaut | Rôle |
|---|---|---|
| `HA_LEADER_TTL_MS` | 15000 | TTL lock leader |
| `HA_SHUTDOWN_TIMEOUT_MS` | 30000 | Drain max avant exit forcé |
| `HA_SEND_LOCK_TTL_MS` | 120000 | TTL lock envoi |
| `RATE_LIMIT_STORE` | auto | `redis` en prod multi-API |
| `EMAIL_QUEUE_BACKOFF_MS` | 5000 | Base exponentielle |
| `EMAIL_QUEUE_BACKOFF_JITTER_MS` | 1000 | Jitter |

---

## 5. Garanties zero-duplicate

1. **Enqueue** : `jobId = idempotencyKey` (BullMQ déduplique)
2. **DB** : `SendAttempt.idempotencyKey @unique`
3. **Runtime** : Redis lock `ha:lock:send:{key}`
4. **Claim** : `updateMany` statut → `PROCESSING`
5. **Post-SMTP** : métadonnée `smtpAccepted` + finalize idempotent
6. **Skip** : si déjà `SENT` / `isSent`

---

## 6. Validation

- Tests unitaires HA (backoff, leader helpers)
- Recettes R-01–R-10 inchangées
- Monitoring `/ops/monitoring` : `instanceCount` workers
- Pas de migration Prisma

---

## 7. Hors scope V1

- Redis Cluster / Sentinel (URL unique suffit pour le pilote)
- Kubernetes HPA (compose scale documenté)
- Rate-limit Redis strict fail-closed sans insurance memory
