# Étape 3 — Optimisation des performances

Suite Phase 11 + nettoyage Étape 2. Vérification ciblée, gaps comblés, mesures.

---

## 1. Checklist vérification

| Domaine | État | Preuve |
|---|---|---|
| Indexes PostgreSQL | OK (+ composite CNDP) | Phase 11 + `20260802120000_etape3_performance_indexes` |
| Requêtes Prisma | OK | Selects liste (contacts, campagnes, audit, **templates sans body**) |
| Pagination | OK | `getSkipTake` + cursor audit (`?cursor=`) |
| Cache Redis | OK | `cacheRemember` dashboard TTL `DASHBOARD_CACHE_TTL_SECONDS` |
| BullMQ | OK | `removeOnComplete` / `removeOnFail` bornés (env) |
| Compression | OK | `compress: true` + cache `_next/static` |
| Lazy loading | OK | Toutes pages dashboard clients via `lazyNamed` |
| Images | OK | AVIF/WebP + `minimumCacheTTL` |
| Bundle Next.js | OK | `optimizePackageImports` + `npm run analyze` |

---

## 2. Gaps comblés (cette étape)

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| `templateListSelect` sans bodyHtml/Text | Liste chargeait HTML complet | Payload API ↓ | Preview via `/preview` déjà | Remettre select complet |
| Lazy sur pages restantes | Audit, templates, ops, compliance… | TTI routes ↓ | Flash loading | Import synchrone |
| Index `(status, dueAt)` DSR | File conformité | Filtres ops plus rapides | Migration additive | `DROP INDEX` |
| Mesures CPU/mémoire | Exigence Étape 3 | Preuves chiffrées | Aucun | — |

---

## 3. Mesures

### Charge contrôlée (`npm run perf:controlled`)

Écrit `docs/final-audit/perf-evidence.json`.

Exemple (2026-08-02) :

| Métrique | Valeur |
|---|---|
| Verdict | `PASS_CONTROLLED_LOAD` |
| Quotas 2k ops | ~473 ms (~4.2k ops/s) |
| Import classify | ~14 ms |
| Template render | ~30 ms |
| Fake mail 200 | &lt; 1 ms |
| Wall | ~518 ms |
| CPU user+system | ~548 ms (ratio ~1.06) |
| RSS avant → après | 77.7 → 113.5 Mo (+35.8) |
| Heap used | 15 → 19.3 Mo (+4.3) |

### Runtime HTTP (`npm run perf:runtime`)

```bash
PERF_BASE_URL=http://127.0.0.1:3000 npm run perf:runtime
```

Écrit `docs/final-audit/perf-runtime.json` (p50/p95 live & ready).

### Bundle

```bash
npm run analyze
```

---

## 4. Commandes

```bash
npx prisma migrate deploy   # nécessite Postgres (Docker)
npm run perf:controlled
PERF_BASE_URL=http://127.0.0.1:3000 npm run perf:runtime
npm run analyze
npm run typecheck
```

> Migration `20260802120000` : appliquer dès que Postgres est up (`docker compose up postgres -d`).

---

## 5. Non-régression

- APIs / RBAC / gates `DRY_RUN` + `PRODUCTION_SENDING_ENABLED` inchangés
- Pagination page/limit rétrocompatible
- Cache dashboard fail-open (TTL 0 = off)
