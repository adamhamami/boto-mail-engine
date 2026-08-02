# Phase 3 — Pipeline événementiel entrant

Date : 2026-07-27  
Statut : **TERMINÉE**  
Migration : `prisma/migrations/20260727020000_phase3_inbound_events`

## Objectif

Chaîne sécurisée :

**Fournisseur / IMAP → réception → authentification → idempotence → normalisation → traitement métier → arrêt de séquence → tâche commerciale → audit / dashboard.**

## Événements supportés

| Type normalisé | Effet métier |
|----------------|--------------|
| `EMAIL_DELIVERED` | Audit `EMAIL_DELIVERED` |
| `EMAIL_REPLIED` | Arrêt séquence + `SalesTask` (une fois) + audit |
| `HARD_BOUNCE` | Aucun retry, exclusion permanente, auto-pause possible |
| `SOFT_BOUNCE` | Retry borné (`SOFT_BOUNCE_MAX_RETRIES`), puis arrêt |
| `COMPLAINT` | Exclusion immédiate |
| `UNSUBSCRIBED` | Suppression globale + arrêt |
| `PROVIDER_ERROR` | Marque attempt FAILED + audit |

## Architecture

### `NormalizedMailEvent`

Contrat indépendant du fournisseur (`src/lib/inbound/types.ts`) :

- `provider`, `providerEventId`, `type`, `messageId`, `timestamp`
- `sender` / `recipient` (minimisés à la persistance via `redactEmail`)
- références `campaignId` / `contactId` / `sendAttemptId` / `campaignRecipientId`
- `rawPayloadReference` + `payloadMinimized` (pas de corps email)

### Flux webhook HTTP

Route : `POST /api/webhooks/mail`

1. Rate limit IP  
2. Limite taille payload  
3. HMAC-SHA256 (`X-Webhook-Signature` + `X-Webhook-Timestamp`) — comparaison constante, anti-replay  
4. Validation Zod — rejet des types inconnus  
5. Persistance idempotente `WebhookEvent(provider, providerEventId)`  
6. Enqueue BullMQ `webhook-process`  
7. Réponse rapide `202` / `200` (duplicate)

**Aucune logique métier lourde dans la route.**

### Worker `webhook-process`

Activé dans `src/workers/index.ts` via `startWebhookWorker()`.

Pour chaque job : résolution SendAttempt / CampaignRecipient → transition → `stopContactSequence` → audit → SalesTask (réponse) → `maybeAutoPauseCampaign`.

### `stopContactSequence`

Implémentation : `src/lib/inbound/stop-sequence.ts`  
Réexport : `src/lib/mail/unsubscribe.ts`

Arrête :

- recipients restants (`isStopped`)
- jobs BullMQ (par `idempotencyKey`) lorsque possible
- send attempts pending → `SKIPPED`
- futures mises en queue (le worker email revalide toujours `isStopped`)

### Adaptateurs entrants

| Adaptateur | Rôle |
|------------|------|
| Webhook HTTP | Canal principal (signature + queue) |
| `MockInboundMailAdapter` | Tests / absence de fournisseur |
| `ImapInboundAdapter` | Préparé — **aucune credential inventée** ; actif seulement si `IMAP_*` renseignés |

## Contrat fournisseur réel

### Headers obligatoires

| Header | Description |
|--------|-------------|
| `X-Webhook-Timestamp` | Epoch **ms** Unix |
| `X-Webhook-Signature` | `hex` ou `sha256=<hex>` = HMAC-SHA256(`{timestamp}.{rawBody}`, `WEBHOOK_SECRET`) |
| `X-Webhook-Provider` | Optionnel (ex. `sendgrid`, `mailgun`, `ses`) — défaut `generic` |

### Corps JSON

```json
{
  "eventId": "unique-provider-event-id",
  "type": "EMAIL_REPLIED",
  "messageId": "provider-message-id",
  "timestamp": "2026-07-27T00:00:00.000Z",
  "sender": "prospect@example.com",
  "recipient": "noreply@botoschool.com",
  "campaignId": "optional",
  "contactId": "optional",
  "sendAttemptId": "optional",
  "campaignRecipientId": "optional",
  "metadata": { "bounceCode": "5.1.1" }
}
```

`type` ∈ `EMAIL_DELIVERED` | `EMAIL_REPLIED` | `HARD_BOUNCE` | `SOFT_BOUNCE` | `COMPLAINT` | `UNSUBSCRIBED` | `PROVIDER_ERROR`.

### Résolution des cibles

Ordre : `sendAttemptId` → `messageId` (= `SendAttempt.providerMessageId`) → `campaignRecipientId` → ids explicites.

### Réponses HTTP

| Code | Sens |
|------|------|
| 202 | Accepté et enfilé |
| 200 | Doublon idempotent |
| 400 | JSON / Zod / type inconnu |
| 401 | Signature / timestamp |
| 413 | Payload trop grand |
| 429 | Rate limit |
| 503 | Secret non configuré (prod) |

## Variables d’environnement

| Variable | Défaut | Notes |
|----------|--------|-------|
| `WEBHOOK_SECRET` | (dev test) | **Requis ≥32 en production** |
| `WEBHOOK_MAX_AGE_SECONDS` | 300 | Anti-replay |
| `WEBHOOK_MAX_PAYLOAD_BYTES` | 65536 | |
| `SOFT_BOUNCE_MAX_RETRIES` | 3 | |
| `AUTO_PAUSE_HARD_BOUNCE_RATE` | 0.05 | Sur campagne RUNNING |
| `AUTO_PAUSE_MIN_EVENTS` | 20 | Minimum avant évaluation |
| `IMAP_HOST` / `USER` / `PASSWORD` | — | Optionnel |

## Fichiers principaux

| Fichier | Rôle |
|---------|------|
| `src/lib/inbound/*` | Types, signature, normalize, ingest, process, stop, auto-pause |
| `src/app/api/webhooks/mail/route.ts` | Ingest sécurisé |
| `src/workers/webhook.worker.ts` | Worker queue |
| `prisma/migrations/20260727020000_phase3_inbound_events` | `provider_event_id` + EventType |

## PII / logs

- Emails stockés **rédigés** dans `WebhookEvent.payload`
- Logs : `redactEmail`, pas de corps email
- Contenu HTML figé dans `SendAttempt.metadata` uniquement pour retry soft-bounce (hors logs)

## Tests

| Scénario | Fichier |
|----------|---------|
| Sans signature / invalide / expiré | `inbound-webhook-auth`, `inbound-webhook-route` |
| Replay idempotent | `inbound-ingest`, `inbound-process-event` |
| Reply / hard / complaint / unsub / soft | `inbound-process-event` |
| SalesTask unique | `inbound-process-event` |
| Redaction PII | `inbound-webhook-auth` |

## Validation

Exécuter :

```bash
npx prisma migrate deploy
npx prisma generate
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## Hors scope Phase 3

- Branchement IMAP réel (client + parsing MIME)
- Mapping signature natif SendGrid/Mailgun (adapter headers → contrat ci-dessus)
- UI dashboard dédiée (les `Event` / `SalesTask` / `Campaign` PAUSED alimentent l’existant)
