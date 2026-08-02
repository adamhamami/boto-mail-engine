# Recette automatisée CDC — R-01 → R-10

Date : 2026-07-27T01:48:23.319Z  
Fuseau : Africa/Casablanca  
**Résultat global : PASS**

> Preuves exécutées uniquement (pas d’inspection code seule).  
> Si un seul critère R-01…R-10 est FAIL → global = FAIL.

## Environnement

- `DRY_RUN=true`
- `PRODUCTION_SENDING_ENABLED=false`
- `ALLOW_TEST_SMTP=false`
- FakeMailProvider / FakeClock
- Aucun SMTP réel, aucune donnée de production
- Fixtures : `tests/fixtures/import-sample.csv|.xlsx`

## Matrice R-01 → R-10

| ID | Statut | Durée (ms) | Commande | Preuve | Limites |
|----|--------|------------|----------|--------|---------|
| R-01 | **PASS** | 76.27670000000126 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json` | PASS RECETTE R-01 Import R-01 CSV fixture parse + mapping (22.1195000000007ms) / PASS RECETTE R-01 Import R-01 XLSX fixt… | Rapport accepté/rejeté testé hors worker DB ; import async BullMQ couvert par parsers + classifyImportSheet. |
| R-02 | **PASS** | 3.191299999999501 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json` | PASS RECETTE R-02 Éligibilité R-02 refuse contact non ÉLIGIBLE en prod (2.0635000000002037ms) / PASS RECETTE R-02 Éligib… | — |
| R-03 | **PASS** | 2.8952999999992244 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json` | PASS RECETTE R-03 Aperçu R-03 détecte variables manquantes (1.2105000000001382ms) / PASS RECETTE R-03 Aperçu R-03 échapp… | — |
| R-04 | **PASS** | 103.22879999999986 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json` | PASS RECETTE R-04 Mode test R-04 allowlist serveur (1.114400000000387ms) / PASS RECETTE R-04 Mode test R-04 plafond 10 (… | — |
| R-05 | **PASS** | 6.372199999999793 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json` | PASS RECETTE R-05 Approbation R-05 schedule prod bloqué si DRY_RUN / PRODUCTION_SENDING_ENABLED (1.3190999999997075ms) /… | — |
| R-06 | **PASS** | 1.2758999999996377 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json` | PASS RECETTE R-06 Idempotence R-06 clé déterministe double clic (0.4193999999997686ms) / PASS RECETTE R-06 Idempotence R… | Concurrence DB réelle si PHASE2_DB_TESTS=1 ; sinon clés/idempotence + claim mock. |
| R-07 | **PASS** | 1.0675000000010186 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json` | PASS RECETTE R-07 Réponse / opt-out R-07 worker skip si RESPONDED (0.44430000000011205ms) / PASS RECETTE R-07 Réponse / … | Arrêt inbound détaillé aussi dans tests/unit/inbound-process-event.test.ts (suite complète). |
| R-08 | **PASS** | 11.866799999997966 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json` | PASS RECETTE R-08 Sécurité R-08 RBAC SALES ne peut pas envoyer / settings (0.9137999999993554ms) / PASS RECETTE R-08 Séc… | IDOR = matrice permissions (pas de session multi-users HTTP dans cette passe).; npm audit --omit=dev = FAIL (vulnérabilités transitive exceljs/nodemailer/next) — documenté, hors correctif breaking dans cette passe |
| R-09 | **PASS** | 2.498700000000099 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json` | PASS RECETTE R-09 Observabilité R-09 correlationId propagé (0.3773000000001048ms) / PASS RECETTE R-09 Observabilité R-09… | Profondeur files Redis réelle via /api/ops/health en runtime ; unit = correlation + provider error. |
| R-10 | **PASS** | 1.6346000000003187 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json` | PASS RECETTE R-10 Export R-10 CSV injection export (0.5961999999999534ms) / PASS RECETTE R-10 Export R-10 RBAC export co… | Export contacts RBAC via permission slug ; pas d’appel HTTP authentifié ici. |

## Détail par critère

### R-01 — PASS

**Commande :** `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json`  
**Fichiers :** `tests/recette/cdc-r01-r10.test.ts`, `tests/unit/imports-segments.test.ts`  
**Durée agrégée :** 76.27670000000126 ms

- [PASS] RECETTE R-01 Import R-01 CSV fixture parse + mapping (22.1195000000007ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-01 Import R-01 XLSX fixture parse (50.75410000000011ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-01 Import R-01 rapport accepté / rejeté / doublons (3.4031000000004497ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`

**Limites :** Rapport accepté/rejeté testé hors worker DB ; import async BullMQ couvert par parsers + classifyImportSheet.

### R-02 — PASS

**Commande :** `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json`  
**Fichiers :** `tests/recette/cdc-r01-r10.test.ts`, `tests/unit/send-gates.test.ts`, `tests/unit/process-email-send.test.ts`  
**Durée agrégée :** 3.191299999999501 ms

- [PASS] RECETTE R-02 Éligibilité R-02 refuse contact non ÉLIGIBLE en prod (2.0635000000002037ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-02 Éligibilité R-02 justification source+consent obligatoire (0.5722999999998137ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-02 Éligibilité R-02 revalidation worker skip CONTACT_MISSING_JUSTIFICATION (0.5554999999994834ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`



### R-03 — PASS

**Commande :** `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json`  
**Fichiers :** `tests/recette/cdc-r01-r10.test.ts`  
**Durée agrégée :** 2.8952999999992244 ms

- [PASS] RECETTE R-03 Aperçu R-03 détecte variables manquantes (1.2105000000001382ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-03 Aperçu R-03 échappe HTML (anti-XSS) (0.5082999999995081ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-03 Aperçu R-03 rendu final + lien désinscription (1.176499999999578ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`



### R-04 — PASS

**Commande :** `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json`  
**Fichiers :** `tests/recette/cdc-r01-r10.test.ts`, `tests/unit/send-gates.test.ts`, `tests/unit/process-email-send.test.ts`  
**Durée agrégée :** 103.22879999999986 ms

- [PASS] RECETTE R-04 Mode test R-04 allowlist serveur (1.114400000000387ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-04 Mode test R-04 plafond 10 (0.2789999999995416ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-04 Mode test R-04 DRY_RUN force simulation — aucun SMTP réel (0.7974999999996726ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-04 Mode test R-04 FakeMailProvider non appelé sous DRY_RUN worker (101.03790000000026ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`



### R-05 — PASS

**Commande :** `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json`  
**Fichiers :** `tests/recette/cdc-r01-r10.test.ts`  
**Durée agrégée :** 6.372199999999793 ms

- [PASS] RECETTE R-05 Approbation R-05 schedule prod bloqué si DRY_RUN / PRODUCTION_SENDING_ENABLED (1.3190999999997075ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-05 Approbation R-05 permission CAMPAIGN_MANAGER peut valider, SALES non (0.9555000000000291ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-05 Approbation R-05 snapshot hash stable (template/sequence/segment/settings) (1.1579000000001543ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-05 Approbation R-05 quota MemoryStore + FakeClock (2.2888999999995576ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-05 Approbation R-05 connecteur FakeMailProvider verifyConnection (0.6508000000003449ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`



### R-06 — PASS

**Commande :** `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json`  
**Fichiers :** `tests/recette/cdc-r01-r10.test.ts`, `tests/unit/data-integrity.test.ts`, `tests/unit/inbound-ingest.test.ts`, `tests/unit/campaign-engine.test.ts`  
**Durée agrégée :** 1.2758999999996377 ms

- [PASS] RECETTE R-06 Idempotence R-06 clé déterministe double clic (0.4193999999997686ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-06 Idempotence R-06 retry même étape = même clé (0.856499999999869ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`

**Limites :** Concurrence DB réelle si PHASE2_DB_TESTS=1 ; sinon clés/idempotence + claim mock.

### R-07 — PASS

**Commande :** `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json`  
**Fichiers :** `tests/recette/cdc-r01-r10.test.ts`, `tests/unit/inbound-process-event.test.ts`, `tests/unit/process-email-send.test.ts`  
**Durée agrégée :** 1.0675000000010186 ms

- [PASS] RECETTE R-07 Réponse / opt-out R-07 worker skip si RESPONDED (0.44430000000011205ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-07 Réponse / opt-out R-07 worker skip si suppression / unsub (0.3589000000001761ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-07 Réponse / opt-out R-07 recipient stopped = arrêt immédiat (0.2643000000007305ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`

**Limites :** Arrêt inbound détaillé aussi dans tests/unit/inbound-process-event.test.ts (suite complète).

### R-08 — PASS

**Commande :** `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json`  
**Fichiers :** `tests/recette/cdc-r01-r10.test.ts`, `tests/unit/inbound-webhook-auth.test.ts`, `tests/unit/permissions.test.ts`, `tests/e2e/rbac-phase6.spec.ts`  
**Durée agrégée :** 11.866799999997966 ms

- [PASS] RECETTE R-08 Sécurité R-08 RBAC SALES ne peut pas envoyer / settings (0.9137999999993554ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-08 Sécurité R-08 IDOR logique : AUDITOR sans write campagnes (0.3206999999993059ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-08 Sécurité R-08 webhook signature invalide rejetée (3.5158999999994194ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-08 Sécurité R-08 webhook signature valide acceptée (1.5200999999997293ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-08 Sécurité R-08 CSV injection neutralisée (0.7916999999997643ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-08 Sécurité R-08 rate limiting (2.2074000000002343ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-08 Sécurité R-08 AUTH_SECRET faible bloqué en prod (2.597200000000157ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`

**Limites :** IDOR = matrice permissions (pas de session multi-users HTTP dans cette passe). npm audit --omit=dev = FAIL (vulnérabilités transitive exceljs/nodemailer/next) — documenté, hors correctif breaking dans cette passe

### R-09 — PASS

**Commande :** `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json`  
**Fichiers :** `tests/recette/cdc-r01-r10.test.ts`, `tests/unit/observability.test.ts`  
**Durée agrégée :** 2.498700000000099 ms

- [PASS] RECETTE R-09 Observabilité R-09 correlationId propagé (0.3773000000001048ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-09 Observabilité R-09 FakeMailProvider erreur exploitable (2.121399999999994ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`

**Limites :** Profondeur files Redis réelle via /api/ops/health en runtime ; unit = correlation + provider error.

### R-10 — PASS

**Commande :** `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json`  
**Fichiers :** `tests/recette/cdc-r01-r10.test.ts`, `tests/unit/imports-segments.test.ts`  
**Durée agrégée :** 1.6346000000003187 ms

- [PASS] RECETTE R-10 Export R-10 CSV injection export (0.5961999999999534ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-10 Export R-10 RBAC export contacts = contacts:read ; audit = audit:export (0.5195000000003347ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`
- [PASS] RECETTE R-10 Export R-10 pas de colonnes secrets dans headers export contacts (0.5189000000000306ms) — `C:/Users/User/Desktop/hassan/tests/recette/cdc-r01-r10.test.ts`

**Limites :** Export contacts RBAC via permission slug ; pas d’appel HTTP authentifié ici.


## Résilience

Statut : **PASS**

- provider indisponible (FakeMail failNext)
- unsubscribe avant envoi
- pause pendant traitement
- FakeClock scheduler
- ALREADY_SENT idempotent
- suite complète : process-email-send, inbound, campaign-engine

## Gates qualité

| Gate | Statut | Durée (ms) | Exit | Commande |
|------|--------|------------|------|----------|
| recette-vitest | **PASS** | 6511 | 0 | `npx vitest run tests/recette/cdc-r01-r10.test.ts --reporter=json --outputFile=C:\Users\User\Desktop\hassan\.tmp\recette-vitest.json` |
| unit-full | **PASS** | 8465 | 0 | `npm test` |
| typescript | **PASS** | 4570 | 0 | `npx tsc --noEmit` |
| lint | **PASS** | 11652 | 0 | `npm run lint` |
| build | **PASS** | 22776 | 0 | `npm run build` |
| npm-audit | **FAIL** | 3464 | 1 | `npm audit --omit=dev` |
| playwright-e2e | **PASS** | 8157 | 0 | `npx playwright test` |

## Artefacts

- Preuves JSON : [`09-TEST-EVIDENCE.json`](./09-TEST-EVIDENCE.json)
- Suite recette : `tests/recette/cdc-r01-r10.test.ts`
- Reporter Vitest : `.tmp/recette-vitest.json`

## Signature

| Rôle | Nom | Date | Visa |
|------|-----|------|------|
| Responsable campagne | | | |
| Administrateur | | | |
| Auditeur | | | |
