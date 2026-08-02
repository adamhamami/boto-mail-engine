# Guide développeur — BotoSchool Email Platform

Public : ingénieurs qui font tourner / modifier le code localement.

---

## 1. Prérequis

- Node.js **20+**
- Docker Desktop (Postgres + Redis)
- Git

---

## 2. Setup local

```bash
npm install
cp .env.example .env
npm run docker:up                 # postgres :5433, redis :6379
npx prisma generate
npx prisma migrate deploy         # ou migrate dev
npm run db:seed
npm run admin:password "MotDePasseFort12!"

# 2 terminaux
npm run dev                       # http://localhost:3000
npm run worker
```

Mailpit (SMTP de test) :

```bash
npm run docker:tools              # UI http://localhost:8025
```

Dans `.env` : pointer SMTP vers Mailpit (`SMTP_HOST=localhost`, port `1025`), garder `DRY_RUN=true` sauf test contrôlé.

---

## 3. Structure à connaître

| Chemin | Usage |
|---|---|
| `src/app/api/**` | Handlers HTTP |
| `src/modules/**` | Services / repos / Zod |
| `src/lib/**` | Infra (auth, queue, mail, security, monitoring) |
| `src/workers/**` | Consommateurs BullMQ |
| `prisma/schema.prisma` | Modèle de données |
| `tests/unit/**` | Vitest |
| `docs/` | Specs & guides |

Architecture : [Architecture.md](../Architecture.md) · données : [Database.md](../Database.md) · API : [API.md](../API.md).

---

## 4. Conventions de code

1. **Validation Zod** sur tout body/query mutable.
2. **RBAC** via `requirePermission(PERMISSIONS.*)` — pas de bypass.
3. **Selects listes légers** (pas de `bodyHtml` en liste templates).
4. **Pas de secrets** dans logs (`safe-log`, redaction Pino).
5. **Gates d’envoi** : ne jamais court-circuiter `DRY_RUN` / `PRODUCTION_SENDING_ENABLED` dans le worker.
6. Prisma : **tagged** `$queryRaw` uniquement (jamais `Unsafe`).
7. UI dashboard : préférer `lazyNamed` pour gros clients.

---

## 5. Ajouter une feature

1. Schéma Prisma + migration si besoin.
2. Validator Zod dans `modules/.../validators`.
3. Repository (selects explicites) + service (audit).
4. Route API sous `app/api/...` + permission.
5. UI client si nécessaire.
6. Tests unitaires ciblés.
7. Mettre à jour doc courte si comportement utilisateur change.

---

## 6. Tests & qualité

```bash
npm run typecheck
npm run lint
npm run test
npm run test:e2e          # Playwright (app up)
npm run validate:final    # gate GO/NO-GO
npm run analyze           # bundle (ANALYZE)
npm run perf:controlled   # charge fake (sans SMTP réel)
```

---

## 7. Observabilité locale

```bash
# Métriques
curl -s "http://127.0.0.1:3000/api/health/live"

# Stack Prom/Grafana (optionnel)
# METRICS_SCRAPE_TOKEN=... dans .env + scrape_token
npm run docker:monitoring
# Grafana http://localhost:3010
```

UI ops (compte avec `ops:read`) : `/ops/monitoring`.

---

## 8. Pièges fréquents

| Symptôme | Cause probable |
|---|---|
| Worker SASL / DB | `.env` non chargé — `dotenv` via `src/lib/config/env.ts` |
| Aucun mail | Worker down ou `DRY_RUN=true` |
| 403 CSRF | Requête API sans Origin / Sec-Fetch-Site |
| 429 | Rate-limit login / API |
| Build prod échoue env | `NEXT_PHASE=phase-production-build` skip validation |

---

## 9. Docs liées

- Sécurité : [27-ETAPE-4-SECURITY.md](../implementation/27-ETAPE-4-SECURITY.md)
- Perf : [26-ETAPE-3-PERFORMANCE.md](../implementation/26-ETAPE-3-PERFORMANCE.md)
- Observabilité : [28-ETAPE-5-OBSERVABILITE.md](../implementation/28-ETAPE-5-OBSERVABILITE.md)
- Tests : [Testing.md](../Testing.md)
- Recette CDC : [Recette.md](../Recette.md)
