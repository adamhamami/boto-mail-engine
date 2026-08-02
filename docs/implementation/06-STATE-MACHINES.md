# Phase 4 — Machines à états

## Campagne

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> TESTED: envoi test
  DRAFT --> PENDING_VALIDATION: soumettre
  TESTED --> PENDING_VALIDATION: soumettre
  PENDING_VALIDATION --> VALIDATED: approuver
  PENDING_VALIDATION --> DRAFT: rejeter
  VALIDATED --> SCHEDULED: planifier (scheduledAt)
  VALIDATED --> RUNNING: démarrer maintenant
  SCHEDULED --> RUNNING: scheduler BullMQ / scan
  RUNNING --> PAUSED: pause manuelle ou auto
  PAUSED --> RUNNING: reprise
  RUNNING --> COMPLETED: tous recipients terminaux
  RUNNING --> CANCELLED: annuler
  PAUSED --> CANCELLED: annuler
  SCHEDULED --> CANCELLED: annuler
  COMPLETED --> [*]
  CANCELLED --> [*]
  RUNNING --> FAILED: incident critique
```

### Transitions critiques

| Transition | Garantie |
|------------|----------|
| `SCHEDULED → RUNNING` | `updateMany` atomique (multi-instance) |
| `RUNNING → PAUSED` | Jobs email retirés ; étapes conservées en DB |
| `PAUSED → RUNNING` | Recalcul créneaux ; pas de re-send SENT |
| `RUNNING → COMPLETED` | Aucun recipient PENDING/SCHEDULED/QUEUED actif |

## Recipient / étape

```mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> SCHEDULED: planifié (delay J+n)
  SCHEDULED --> QUEUED: créneau / enqueue
  PENDING --> QUEUED: J0 immédiat
  QUEUED --> SENT: SMTP OK + DB OK
  QUEUED --> SKIPPED: inéligible / pause policy / opt-out
  QUEUED --> STOPPED: reply / bounce / complaint
  QUEUED --> FAILED: échec définitif
  SCHEDULED --> STOPPED: stopContactSequence
  SENT --> [*]
  SKIPPED --> [*]
  STOPPED --> [*]
  FAILED --> [*]
```

## SendAttempt

```mermaid
stateDiagram-v2
  [*] --> QUEUED
  QUEUED --> PROCESSING: worker pick
  PROCESSING --> SENT: succès
  PROCESSING --> FAILED: erreur (retry BullMQ)
  FAILED --> PROCESSING: retry
  FAILED --> SKIPPED: exhausted / policy
  QUEUED --> SKIPPED: campagne pausée / stop
  PROCESSING --> SENT: reprise smtpAccepted (SMTP OK DB KO)
```

## Séquence contact (métier CDC)

```mermaid
flowchart TD
  A[Étape 1 J0] --> B{Réponse / opt-out / blocage?}
  B -->|oui| Z[Arrêt séquence]
  B -->|non| C[Étape 2 J+4..6]
  C --> D{Réponse / opt-out / blocage / inéligible?}
  D -->|oui| Z
  D -->|non| E[Étape 3 J+10..14]
  E --> F[Fin automatique]
  Z --> F
```

## Scheduler

```mermaid
sequenceDiagram
  participant API
  participant Q as campaign-scheduler
  participant W as Campaign Worker
  participant DB
  participant E as email-send

  API->>DB: status=SCHEDULED
  API->>Q: delayed job campaign-start:id
  Note over Q: redémarrage OK — jobId stable
  Q->>W: due
  W->>DB: claim VALIDATED/SCHEDULED→RUNNING
  alt claim gagné
    W->>E: enqueue étapes (delays)
  else déjà claimé
    W-->>W: no-op idempotent
  end
  loop scan every 1m
    Q->>W: campaign-scan
    W->>DB: findDue SCHEDULED
    W->>DB: startCampaign
  end
```
