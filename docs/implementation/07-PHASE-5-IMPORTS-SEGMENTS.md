# Phase 5 — Imports et segmentation

Date : 2026-07-27  
Statut : **TERMINÉE**  
Migration : `prisma/migrations/20260727040000_phase5_imports_segments`

## Objectif

Rendre R-01 démontrable : import CSV/XLSX sécurisé + segmentation CDC + exports CSV sûrs.

## Workflow import

1. Sélection fichier (UI)
2. Validation taille / MIME / extension
3. Lecture en-têtes
4. Mapping colonnes (suggestion auto)
5. Aperçu validé
6. Rapport erreurs (échantillon)
7. Confirmation
8. Enqueue BullMQ `import-process` (HTTP rapide)
9. Worker : accepté / rejeté / doublon / suppression list
10. Progression visible (polling)

### Sécurité fichier

- CSV via `csv-parse` ; XLSX via **exceljs** (remplace `xlsx`)
- Aucune exécution de formules / macros
- Stockage `.tmp/imports` mode 0600 + purge auto
- Limites : `IMPORT_MAX_FILE_BYTES`, `IMPORT_MAX_ROWS`

### Dédoublonnage

- Doublons internes fichier
- Doublons DB (`emailNormalized`)
- SuppressionList → rejeté
- Soft-deleted → rejeté (pas de réactivation auto)
- Conflit org → signalé, org existante conservée
- **Jamais ÉLIGIBLE** à l’import → `IMPORTED` / `TO_REVIEW`

## Segments CDC

Filtres : ville, type établissement (`Organization.industry`), taille, statut, owner, tags, organisation, `eligibleOnly`.

Aperçu : `/api/segments/preview` → matching, éligibles, exclus, raisons, page contacts.

Campagnes : snapshot `segmentVersion` + filters (Phase 2/4) inchangé.

## Exports

- `GET /api/contacts/export` — RBAC `contacts:read`, audit, formule CSV neutralisée
- `GET /api/audit/export` — même neutralisation (`= + - @`)

## Fichiers clés

| Zone | Path |
|------|------|
| Parse / temp | `src/lib/imports/*` |
| CSV safe | `src/lib/export/csv-safe.ts` |
| Worker | `src/workers/import.worker.ts`, `process-import.ts` |
| API | `api/imports/upload`, `mapping`, `preview`, `confirm` |
| UI | `imports-client.tsx`, `segments-client.tsx` |
| Fixtures | `tests/fixtures/import-sample.csv`, `.xlsx` |

## Validation

```bash
npx prisma migrate deploy && npx prisma generate
npm test && npx tsc --noEmit && npm run lint && npm run build
```
