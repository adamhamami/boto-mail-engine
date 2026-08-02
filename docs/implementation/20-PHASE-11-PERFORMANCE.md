# Phase 11 — Performance

Objectif : optimiser Next.js, Prisma, Redis, BullMQ, cache, pagination, indexes,
compression, lazy loading, images et bundle — **sans casser** APIs / RBAC / gates.

---

## 1. Synthèse

| Domaine | Action |
|---|---|
| Next.js | `compress`, `optimizePackageImports`, `images` AVIF/WebP, cache `_next/static` |
| Bundle | `@next/bundle-analyzer` → `npm run analyze` |
| Prisma | Selects list légers + indexes additifs + completion sans N+1 |
| Redis | `cacheRemember` dashboard (TTL 30s) |
| BullMQ | `removeOnFail` / `removeOnComplete` bornés (count + age) |
| Pagination | Cursor helpers + audit API (`?cursor=` keyset, page/limit inchangé) |
| Lazy load | `next/dynamic` campaigns, wizard, dashboard, monitoring, smtp, dns, contacts |
| Images | Config `next/image` AVIF/WebP (pas de wrapper inutilisé) |
| Compression | HTTP gzip Next + logs déjà gzip (Phase 5) |

---

## 2. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| List selects allégés | Listes chargeaient `bodyHtml` / JSON audit | Payloads API ↓ | UI détail inchangé (select complet) | Remettre select partagé |
| Indexes | Filtres audit / send attempts | Queries ops plus rapides | Migration additive | `DROP INDEX` |
| Dashboard SQL + cache | Chart chargeait tous les events | CPU/IO ↓ | Cache 30s légèrement stale | `DASHBOARD_CACHE_TTL_SECONDS=0` |
| Completion batch | N+1 par contact | Workers plus fluides | Logique équivalente | Revenir boucle |
| BullMQ retention | Redis grossissait (fail forever) | Mémoire Redis ↓ | Moins d’historique jobs | Remonter counts |
| Lazy routes | Gros clients dans le graphe initial | TTI dashboard ↓ | Flash loading | Import synchrone |

---

## 3. Indexes (migration)

`prisma/migrations/20260801120000_phase11_performance_indexes`

- `send_attempts (status, queued_at)`
- `send_attempts (provider_message_id)`
- `audit_logs (module, created_at)`
- `audit_logs (action, created_at)`

```bash
npx prisma migrate deploy
```

---

## 4. Commandes

```bash
npm run typecheck
npm run test
npm run analyze          # rapport bundle
npm run perf:controlled  # charge contrôlée existante
```

Env utiles :

| Variable | Défaut | Rôle |
|---|---|---|
| `DASHBOARD_CACHE_TTL_SECONDS` | 30 | 0 = off |
| `EMAIL_QUEUE_COMPLETE_RETENTION_*` | 1000 / 24h | jobs OK |
| `EMAIL_QUEUE_FAIL_RETENTION_*` | 5000 / 7j | jobs KO |

---

## 5. Fichiers clés

- `next.config.ts`
- `src/lib/cache/redis-cache.ts`
- `src/lib/api/pagination.ts`
- `src/lib/campaign-engine/completion.ts`
- `src/modules/*/repositories/*` (list selects)
- `src/components/perf/lazy-client.tsx`
- `src/components/perf/lazy-client.tsx`
- `src/modules/audit/services/audit.service.ts` (liste légère + cursor)
