# Étape 7 — Staging complet

Pré-production Docker (Mailpit + DRY_RUN) + smoke + checklist scénarios.

---

## 1. Livrables

| Élément | Path |
|---|---|
| Runbook | [docs/production/11-STAGING.md](../production/11-STAGING.md) |
| Deploy PS1/SH | `scripts/deploy-docker-staging.ps1` / `.sh` |
| Smoke | `scripts/smoke-staging.mjs` → `npm run smoke:staging` |
| Scénarios moteur | `scripts/staging-engine-scenarios.ts` |
| Preuve | `docs/final-audit/staging-smoke.json` (généré) |

---

## 2. Scénarios couverts

| Scénario | Auto | Manuel UI |
|---|---|---|
| Imports | classify | upload/process |
| Campagnes | recette opt-in | validate/schedule |
| Workers | docker health | monitoring |
| Webhooks | HMAC unit | POST signé |
| Quotas | MemoryQuotaStore | ops UI |
| Pause / reprise | fenêtre quotas | pause/resume campagne |
| Erreurs | FakeMail fail | DLQ |
| Crash recovery | restart worker | heartbeat |

**Jamais** `DRY_RUN=false` ni `PRODUCTION_SENDING_ENABLED=true` dans les scripts.

---

## 3. Commandes

```bash
npm run deploy:staging
npm run smoke:staging
```

---

## 4. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Deploy staging | Préprod reproductible | MTTD ↓ | Ports locaux | `docker:down:staging` |
| Smoke | Preuve chiffrée | GO staging | Docker requis | Skip restart |
| Checklist UI | Couverture métier | Qualité | Temps humain | — |
