# Phase 1 — Sécurisation immédiate des envois

Date : 2026-07-27  
Statut : **TERMINÉE**  
Références : CDC V1, `docs/audit-emailing/AUDIT-COMPLET.md`, `00-BASELINE.md`, `01-BACKLOG.md`

## Objectif

Fermer les risques critiques d’envoi réel accidentel (DRY_RUN, allowlist, revalidation worker, AUTH_SECRET, gates production), sans séquences multi-étapes ni webhooks complets.

## Fichiers modifiés / ajoutés

| Fichier | Action |
|---------|--------|
| `src/lib/config/env.ts` | AUTH_SECRET strict prod ; `ALLOW_TEST_SMTP`, allowlists, `SMTP_ALLOWED_NODE_ENVS` ; `resetEnvCache` |
| `src/lib/compliance/send-gates.ts` | Allowlist, `assertSendExecutionAllowed`, `evaluateWorkerSendReadiness`, DRY_RUN absolu |
| `src/lib/mail/fake-provider.ts` | **Nouveau** FakeMailProvider |
| `src/lib/mail/index.ts` | Override injectable pour tests |
| `src/workers/process-email-send.ts` | **Nouveau** logique worker + revalidation |
| `src/workers/email.worker.ts` | Délègue à `processEmailSend` |
| `src/modules/campaigns/services/campaign.service.ts` | Gates schedule/enqueue + allowlist + verify SMTP si réel |
| `.env.example` | Nouvelles variables (sans secrets sensibles) |
| `tests/unit/send-gates.test.ts` | Réécrit Phase 1 |
| `tests/unit/process-email-send.test.ts` | **Nouveau** |
| `docs/implementation/00-BASELINE.md` | Créé |
| `docs/implementation/01-BACKLOG.md` | Créé / mis à jour |
| `docs/implementation/03-PHASE-1-SAFETY.md` | Ce rapport |
| `src/hooks/use-mobile.ts` | Fix lint (hors scope métier, requis validation) |
| `src/app/(dashboard)/settings/settings-client.tsx` | Fix lint |
| `src/app/api/contacts/route.ts` | Fix lint unused import |
| `src/lib/mail/smtp-provider.ts` | Fix lint unused param |

## Règles ajoutées

### A. DRY_RUN

- `mustSimulateProviderSend()` ⇒ si `DRY_RUN=true`, **aucun** appel `MailProvider.send`.
- Le mode test **ne contourne plus** DRY_RUN (`simulateOnly = DRY_RUN` uniquement, plus `&& !isTestMode`).

### B. Allowlist test

- `TEST_EMAIL_ALLOWLIST` / `TEST_DOMAIN_ALLOWLIST` (CSV, normalisés lowercase).
- `isTestRecipient` **insuffisant** ; refus hors allowlist avant enqueue et dans le worker.
- Allowlists vides ⇒ aucun destinataire de test accepté (fail closed).

### C. Revalidation worker

Lecture fraîche puis `evaluateWorkerSendReadiness` :

- campagne `RUNNING` \| `TESTED` ;
- recipient non arrêté / non déjà envoyé ;
- contact présent, non supprimé, non doublon ;
- hors `BLOCKED_SEND_STATUSES` (RESPONDED, UNSUBSCRIBED, HARD_BOUNCED, BLOCKED, …) ;
- production : ELIGIBLE \| IN_SEQUENCE + source + consentBase ;
- test : allowlist ;
- SuppressionList ;
- puis `assertSendExecutionAllowed` avant SMTP.

Échec ⇒ `SendAttempt` `SKIPPED` + metadata `SEND_POLICY_SKIP` + log sans PII/secrets.

### D. `assertSendExecutionAllowed`

Appelée en phases `schedule`, `enqueue`, `worker`.  
SMTP réel exige : `DRY_RUN=false` + `NODE_ENV ∈ SMTP_ALLOWED_NODE_ENVS` + (`ALLOW_TEST_SMTP` si test **ou** `PRODUCTION_SENDING_ENABLED` si prod).  
Enqueue réel : `verifyConnection()` obligatoire.

### E. AUTH_SECRET

- Production : obligatoire ≥32 chars, refuse placeholders connus ; démarrage échoue clairement.
- Dev/test : secret de test explicite `test-only-auth-secret-do-not-use-in-production!!` si absent.

## Tests

| Preuve | Couverture |
|--------|------------|
| DRY_RUN n’appelle jamais le provider | `process-email-send.test.ts` + FakeMailProvider |
| Campagne test ne contourne pas DRY_RUN | `send-gates` + process |
| Adresse hors allowlist refusée | `send-gates` + process |
| RESPONDED après enqueue ⇒ skip | process |
| Désinscrit (suppression) après enqueue ⇒ skip | process |
| Campagne pausée ⇒ skip | process |
| AUTH_SECRET absent/faible bloque prod | `send-gates` |
| Pas de secret dans logs/metadata tests | process + gates |

**FakeMailProvider uniquement** — aucun Nodemailer dans les tests.

## Résultats validation

| Commande | Résultat |
|----------|----------|
| `npm test` | **PASS** 26/26 |
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |

## Correspondance recette

| Critère | Impact Phase 1 |
|---------|----------------|
| **R-02** Éligibilité | Revalidation worker source/consent/statut ; skip si RESPONDED etc. |
| **R-04** Mode test | Allowlist serveur ; DRY_RUN non contourné ; préfixe TEST/DRY_RUN conservé |
| **R-05** Approbation / prod | Gates SMTP réel + connecteur sain à l’enqueue réel |
| **R-07** Opt-out / réponse | Skip worker si suppression ou statut bloquant (branchement `stopContactSequence` toujours Phase suivante) |
| **R-08** Sécurité | AUTH_SECRET prod ; pas de secret dans logs de skip ; password SMTP inchangé (`***`) |

## Limites restantes (hors Phase 1)

- `stopContactSequence` toujours non branché sur UI réponses / webhooks.
- Webhooks non signés / non traités.
- Pas d’EventType dédié `SEND_SKIPPED` (metadata attempt seulement).
- Quotas horaires / créneaux d’envoi non implémentés (structure absente).
- Scheduler `SCHEDULED` toujours inerte.
- Séquences multi-étapes non exécutées.
- `Contact.email` toujours sans `@unique` DB.
- Import UI toujours JSON (pas CSV/XLSX).

## Configuration opérateur

```env
DRY_RUN=true
ALLOW_TEST_SMTP=false
PRODUCTION_SENDING_ENABLED=false
TEST_EMAIL_ALLOWLIST=qa@botoschool.ma
TEST_DOMAIN_ALLOWLIST=botoschool.ma
SMTP_ALLOWED_NODE_ENVS=production
```

SMTP de test réel uniquement si : `DRY_RUN=false` + `ALLOW_TEST_SMTP=true` + `NODE_ENV` autorisé + destinataire allowlisté + connecteur sain.
