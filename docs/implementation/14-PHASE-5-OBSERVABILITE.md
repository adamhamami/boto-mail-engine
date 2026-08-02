# Phase 5 — Observabilité

Objectif : logs structurés JSON, Correlation ID, Request ID, tracing léger,
audit enrichi, rotation et compression des logs — sans casser les recettes ni
les workers existants.

---

## 1. Structured Logs + JSON

**Reuse** : Pino (`src/lib/logger/index.ts`).

| Mode | Format |
|---|---|
| `development` (défaut) | `pino-pretty` |
| `production` / `LOG_JSON=true` | JSON stdout natif |
| `LOG_TO_FILE=true` | stdout JSON **+** fichiers rotatés |

Chaque ligne JSON porte via **mixin ALS** : `correlationId`, `requestId`,
`traceId`, `spanId`, plus `app`, `env`, `level`, `time` (ISO).

Redaction Phase 1 inchangée (secrets jamais loggés).

---

## 2. Correlation ID / Request ID

| ID | Header | Portée |
|---|---|---|
| `correlationId` | `x-correlation-id` | Bout-en-bout (API → worker) |
| `requestId` | `x-request-id` | Hop HTTP courant |

- **Middleware Edge** : génère / propage les deux + `traceparent`, les injecte
  dans la requête aval (`NextResponse.next({ request: { headers } })`).
- **`withRequestContext`** : peuple l'ALS Node pour les handlers.
- **`apiSuccess` / `apiError`** : renvoient les IDs en body + headers.

---

## 3. Tracing

Tracing **W3C Trace Context** léger (`src/lib/observability/tracing.ts`) —
**sans** SDK OpenTelemetry (zéro nouvelle dépendance lourde).

- Parse / génère `traceparent`
- Span enfant worker via `childSpan`
- Champs `traceId` / `spanId` dans logs + audit

Compatible avec un collecteur OTel ultérieur qui lit les mêmes headers.

---

## 4. Audit enrichi

`AuditService.log` fusionne automatiquement dans `metadata` :

- `correlationId`, `requestId`, `traceId`, `spanId`, `campaignId`

Les valeurs explicites de l'appelant priment. Pas de migration Prisma —
`metadata` Json suffit.

Helper HTTP : `extractClientMeta(req)` pour IP / User-Agent.

---

## 5. Rotation + compression

### App (optionnel) — `LOG_TO_FILE=true`

- Transport `pino-roll` : rotation daily + taille (`LOG_MAX_SIZE`, défaut 20m)
- Rétention `LOG_MAX_FILES` (défaut 14)
- Compression gzip des archives via `startLogCompressionScheduler`
  (pino-roll@4 ne compresse pas nativement)

### Docker (production) — toujours actif

```yaml
logging:
  driver: json-file
  options:
    max-size: "20m"
    max-file: "14"
    compress: "true"
```

Stdout JSON reste le chemin principal pour les collecteurs (Loki, CloudWatch…).

---

## 6. Propagation worker

`EmailSendJobData` accepte `correlationId` / `requestId` / `traceId` / `spanId`
(optionnels — rétrocompat).

`enqueueEmailJob` les remplit depuis l'ALS. Le worker email wrappe
`processEmailSend` dans `runWithContext` + span enfant.

---

## 7. Impact / risques / rollback

- **Impact** : headers observabilité sur toutes les réponses middleware ;
  jobs email légèrement plus gros (4 champs string optionnels).
- **Risque** : `LOG_TO_FILE` sur disque plein — défaut `false` ; Docker
  json-file borné.
- **Rollback** : `LOG_TO_FILE=false` ; retirer logging docker-compose ;
  IDs restent additifs (pas de breaking API métier).
- **Migration Prisma** : aucune.

---

## 8. Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `LOG_JSON` | true hors dev | Force JSON |
| `LOG_TO_FILE` | false | Fichiers rotatés |
| `LOG_DIR` | `logs` | Répertoire |
| `LOG_MAX_SIZE` | `20m` | Taille avant rotation |
| `LOG_MAX_FILES` | 14 | Rétention |
| `LOG_COMPRESS` | true | Gzip archives fichier |

---

## 9. Tests

`tests/unit/observability-phase5.test.ts` — IDs, tracing W3C, audit enrichi,
compression gzip.
