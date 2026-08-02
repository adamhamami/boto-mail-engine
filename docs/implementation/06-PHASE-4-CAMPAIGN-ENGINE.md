# Phase 4 — Moteur de campagnes et séquences

Date : 2026-07-27  
Statut : **TERMINÉE**  
Migration : `prisma/migrations/20260727030000_phase4_campaign_engine`

## Objectif

Moteur fiable : planification, 3 étapes max, délais CDC, quotas Redis, créneaux Africa/Casablanca, pause/reprise, arrêt événementiel, terminaison auto, reprise après incident.

## CDC — étapes

| Étape | Contenu | Délai |
|-------|---------|-------|
| 1 | Introduction | J0 (`delayDays=0`) |
| 2 | Relance courte | J+4 à J+6 |
| 3 | Dernier suivi | J+10 à J+14 |

Max **3 EMAIL** en V1. Validation dans `sequence.validator.ts` + `planEmailSteps`.

## Scheduler campagne (`SCHEDULED`)

- Queue BullMQ `campaign-scheduler` (pas de `setInterval` Next.js).
- `schedule()` → status `SCHEDULED` + job différé `campaign-start:{campaignId}`.
- Job répétable `campaign-scan` (1 min) pour reprise après incident.
- Démarrage idempotent : `updateMany` atomique `VALIDATED|SCHEDULED → RUNNING`.
- Multi-instance : un seul claim gagne ; double clic / double worker safe.

## Étapes recipient

Champs `CampaignRecipient` : `scheduledAt`, `status` (`RecipientStepStatus`), `templateId`, `contentVersion`, `skipReason` + idempotency key sur `SendAttempt`.

Contenu figé au démarrage (pas de nouvelle version template silencieuse).

## Quotas (Redis)

Limites : heure, jour, connecteur, domaine expéditeur, campagne.  
`INCR` + TTL — multi-worker. Store mémoire injectable pour tests.

## Créneaux

- Fuseau défaut : **Africa/Casablanca**
- Jours / heures configurables (env + `campaign.settings`)
- Report vers prochain créneau
- Override saisonnier explicite (ex. Ramadan) — aucune valeur cachée
- DST via IANA `Africa/Casablanca`

## Pause / reprise

- Pause : status `PAUSED`, jobs retirés, metadata `paused` + position logique
- Reprise : revalidation, recalcul créneau, ré-enqueue non-SENT uniquement

## Terminaison

`maybeCompleteCampaign` → `COMPLETED` quand plus d’étapes ouvertes (SENT / STOPPED / SKIPPED / FAILED / contacts terminaux).

## Auto-pause

Seuils : hard bounce, complaint, provider error, connecteur indisponible, anomalie volume.

## Fichiers

| Zone | Path |
|------|------|
| Engine | `src/lib/campaign-engine/*` |
| Worker | `src/workers/campaign.worker.ts` |
| Send | `src/workers/process-email-send.ts` |
| Service | `src/modules/campaigns/services/campaign.service.ts` |
| State machines | `docs/implementation/06-STATE-MACHINES.md` |

## Env

`SEND_QUOTA_*`, `CAMPAIGN_DEFAULT_TIMEZONE`, `SEND_WINDOW_*`, `AUTO_PAUSE_COMPLAINT_RATE`, `AUTO_PAUSE_PROVIDER_ERROR_RATE`, …

## Validation

```bash
npx prisma migrate deploy && npx prisma generate
npm test && npx tsc --noEmit && npm run lint && npm run build
```
