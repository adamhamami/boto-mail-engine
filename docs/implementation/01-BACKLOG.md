# Backlog d’implémentation

## Phase 1 — Sécurisation immédiate des envois ✅

- [x] DRY_RUN jamais contourné (y compris mode test)
- [x] Allowlist serveur `TEST_EMAIL_ALLOWLIST` / `TEST_DOMAIN_ALLOWLIST`
- [x] Revalidation worker avant SMTP
- [x] `assertSendExecutionAllowed` central
- [x] AUTH_SECRET sans défaut en production
- [x] Tests FakeMailProvider + rapport `03-PHASE-1-SAFETY.md`

## Phase 2 — Intégrité PostgreSQL / Prisma ✅

- [x] `email_normalized` + unicité partielle
- [x] Script détection doublons non destructif
- [x] Idempotence déterministe campagne/contact/étape/version
- [x] Versioning template / sequence / segment
- [x] Snapshot d’approbation + invalidation
- [x] Entité `SalesTask`
- [x] Index workers/segments
- [x] Docs `04-PHASE-2-DATA.md` + `04-DUPLICATE-MIGRATION-PLAN.md`

## Phases suivantes (reportées)

- P0-1 / P0-5 : stopContactSequence + webhooks
- P0-7 : séquences multi-étapes
- P0-8 : scheduler SCHEDULED
- P0-9 : import CSV/XLSX réel
- UI fusion doublons / API SalesTask
