# Étape 2 — Nettoyage du code

Objectif : maintenabilité (code mort, doublons, noms clairs) **sans** changer le comportement métier.

---

## Actions

| Action | Détail |
|---|---|
| Code mort UI | Supprimé `optimized-image`, `switch`, `checkbox`, `scroll-area`, `tabs` (0 import) |
| Barrels inutilisés | Supprimé `lib/campaign-engine/index.ts`, `lib/inbound/index.ts` |
| Dossier vide | Supprimé `src/lib/di/` |
| API types | Contrat unique `src/lib/api/types.ts` partagé client/serveur |
| Pagination | Audit + sales-tasks utilisent `getSkipTake` |
| Send-gates | Supprimé `normalizeEmail` alias + `assertProductionSendingAllowed` deprecated |
| Noms | `emailNorm` → `emailNormalized` dans `process-import.ts` |
| Commentaires | Clarification `getSkipTake` |

---

## Vérification

```bash
npm run typecheck
npm test
npm run lint
```

Risque : bas — suppressions non référencées + factorisations locales.
