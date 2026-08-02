# Phase 6 — Interface, observabilité et exploitation

Date : 2026-07-27  
Statut : **TERMINÉE**

## Objectif

Brancher l’UI sur les backends Phase 1–5 (données réelles, pas de boutons décoratifs), enrichir l’observabilité et aligner menus / API / Server Actions sur le RBAC.

## Écrans

| Écran | Route | Source données |
|-------|-------|----------------|
| Dashboard | `/dashboard` | `GET /api/dashboard/stats` (KPIs + quotas + file/DLQ + connecteur) |
| Contacts / imports | `/contacts`, `/imports` | APIs existantes Phase 5 |
| Segments | `/segments` | APIs + preview |
| Modèles / séquences | `/templates`, `/sequences` | APIs existantes |
| Assistant campagne | `/campaigns/new` | 6 étapes → create/update + readiness + schedule/validate |
| Réponses / exclusions | `/responses`, `/suppression` | APIs existantes |
| Tâches commerciales | `/sales-tasks` | `GET /api/sales-tasks`, `POST …/complete` |
| Paramètres / audit | `/settings`, `/audit` | APIs existantes (SMTP masqué `***`) |
| Santé technique | `/ops` | `GET /api/ops/health` (RBAC `ops:read`) |

Navigation : `AppSidebar` filtrée par `filterNavItems(session.permissions)` — layout serveur Auth.js.

## Assistant campagne (6 étapes)

1. Audience (segment)  
2. Séquence ou modèle  
3. Personnalisation (`isTestMode`)  
4. Calendrier / quotas (fuseau `Africa/Casablanca` par défaut)  
5. Test → `POST /api/campaigns/:id/schedule` en mode test (gates serveur)  
6. Approbation — récap via `GET /api/campaigns/:id/readiness` puis submit / validate / schedule  

Récap pré-validation : total, éligible, exclu, variables manquantes, versions template/séquence, expéditeur, créneaux, quotas, connecteur, DRY_RUN, avertissements / blocages.

Aucun bouton ne contourne les contrôles serveur (`assertSendExecutionAllowed`, validation, snapshot).

## Dashboard — métriques réelles

Contacts importés / éligibles, envoyés, délivrés, rebonds, réponses, réponses positives, désinscriptions, demandes de démo, tâches ouvertes, campagnes actives, quotas h/j, file, DLQ, dernier événement, erreurs récentes, santé connecteur.

## Observabilité

- `correlationId` (ALS + header `x-correlation-id` + corps API)  
- Champs contextuels : `campaignId`, `recipientId`, `jobId`, `providerEventId`  
- Ops : profondeur files / DLQ, retries, last successful send, last inbound, health DB / Redis / worker / provider  
- `safe-log` filtre secrets / payloads sensibles  

**Jamais affichés** : `SMTP_PASSWORD`, tokens complets, `AUTH_SECRET`, payloads bruts, corps d’email inutiles.

## RBAC

Nouvelles permissions : `sales_tasks:read|write`, `ops:read`.

| Rôle | Menus notables |
|------|----------------|
| ADMIN | Tout |
| CAMPAIGN_MANAGER | Campagnes, imports, ops, tâches — pas users/audit |
| SALES | Réponses, tâches, dashboard — pas imports/ops/settings |
| AUDITOR | Audit, ops, lecture — pas tâches / imports |

## Fichiers clés

| Zone | Path |
|------|------|
| Nav RBAC | `src/lib/auth/nav.ts`, `app-sidebar.tsx`, `(dashboard)/layout.tsx` |
| Ops | `src/lib/observability/*`, `api/ops/health`, `api/health` |
| Dashboard | `dashboard.service.ts`, `dashboard-client.tsx` |
| Readiness | `campaign.service#getReadiness`, `api/campaigns/[id]/readiness` |
| Wizard | `campaigns/new/campaign-wizard-client.tsx` |
| Tâches | `api/sales-tasks`, `sales-tasks/*` |

## Validation

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
npx playwright install chromium   # si besoin
npx playwright test
```

Tests : `tests/unit/nav-rbac.test.ts` (matrice 4 rôles), `tests/unit/observability.test.ts`, `tests/e2e/rbac-phase6.spec.ts` (redirections + API sans auth).

Après seed, rejouer `npm run db:seed` pour synchroniser les nouvelles permissions (`sales_tasks:*`, `ops:read`) en base.
