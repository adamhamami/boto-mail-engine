# Performance & résilience — audit final

Date : 2026-07-27  
Charge : **contrôlée avec mocks** (FakeMailProvider, FakeClock, MemoryQuotaStore)  
Aucun SMTP réel, aucune écriture production.

Preuve machine : [`perf-evidence.json`](./perf-evidence.json)  
Script : `npx tsx scripts/perf-controlled.ts`

---

## Résultats charge contrôlée (n=2000)

| Scénario | Durée | Débit | Verdict |
|---|---:|---:|---|
| Consommation quotas mémoire | 312 ms | ~6411 ops/s | PASS |
| Classification import (accept/reject) | 23 ms | ~85k rows/s | PASS |
| Rendu template + escape HTML | 23 ms | ~87k ops/s | PASS |
| Burst FakeMail 200 msgs | <1 ms | mock local | PASS |

**Verdict global charge mock : PASS_CONTROLLED_LOAD**

---

## Limites de cette mesure

- Pas de latence réseau SMTP.
- Pas de contention PostgreSQL / Redis multi-worker réelle.
- Quotas MemoryStore ≠ Redis INCR multi-instance (couvert unitairement ailleurs).
- Import classification ≠ parse XLSX 50 Mo sur disque.

Pour un pilote : rejouer sur staging avec Redis + Postgres + worker, volume ≤ quota journalier configuré.

---

## Résilience (tests existants)

| Scénario | Couverture |
|---|---|
| Provider indisponible | FakeMail `failNext` + recette |
| Unsubscribe avant envoi | worker skip `EMAIL_SUPPRESSED` |
| Pause pendant traitement | `CAMPAIGN_NOT_SENDABLE` |
| Retry / ALREADY_SENT | readiness + idempotency |
| Scheduler FakeClock | Phase 4 |
| Webhook dupliqué | ingest unique providerEventId |
| Redis/DB down (health) | `/api/health` → unhealthy ; ops report |

Non exécuté en charge réelle : Redis down pendant enqueue massif, failover worker HA.

---

## Observabilité liée perf

- `/api/ops/health` : profondeur files, DLQ, last send, retries.
- Dashboard : file / DLQ / quotas.
- `correlationId` dans réponses API / logs contextualisés.

---

## Recommandations pilote

1. Plafonds : `SEND_QUOTA_PER_HOUR` / `PER_DAY` bas au démarrage.
2. Alerter si DLQ > 0 ou status ops `degraded`.
3. Mesurer p95 enqueue + worker sur staging avant volume réel.
4. Garder créneaux Africa/Casablanca et jours ouvrés.
