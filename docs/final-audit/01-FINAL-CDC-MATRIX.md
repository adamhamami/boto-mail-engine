# Matrice finale CDC ↔ code

Date : 2026-07-27  
Sources : PDF CDC V1.0, `AUDIT-COMPLET.md`, `docs/implementation/*`, code actuel, `09-TEST-EVIDENCE.json`.

Légende statut : **COMPLET+TESTÉ** | **COMPLET** | **PARTIEL** | **ABSENT** | **HORS V1**

---

## Exigences CDC majeures

| Exigence CDC | Code | Tests / preuve | Statut final | Avant |
|---|---|---|---|---|
| Import CSV/XLSX + mapping + rapport | `lib/imports/*`, worker `import-process`, UI imports | R-01 PASS | **COMPLET+TESTÉ** | PARTIEL / JSON |
| Segmentation ville/type/taille/statut/owner/tags | `buildContactFilterWhere`, preview | Phase 5 + unit | **COMPLET+TESTÉ** | PARTIEL |
| Éligibilité + justification source/consent | `send-gates`, qualify | R-02 PASS | **COMPLET+TESTÉ** | PARTIEL |
| Aperçu template + vars manquantes + escape | `render-template`, `escapeHtml` | R-03 PASS | **COMPLET+TESTÉ** | PARTIEL |
| Mode test max 10 + allowlist + DRY_RUN | `TEST_MODE_MAX`, allowlists, FakeMail | R-04 PASS | **COMPLET+TESTÉ** | FAIL bypass |
| Approbation + snapshot + quotas/créneaux | `validate`, approval hash, quotas, windows | R-05 PASS | **COMPLET+TESTÉ** | PARTIEL |
| SoD créateur ≠ approbateur | `assertApproverIsNotCreator` | approval-sod tests | **COMPLET+TESTÉ** | PASS |
| Idempotence envoi / webhook | clés déterministes, unique DB, ingest | R-06 + inbound | **COMPLET+TESTÉ** | PARTIEL |
| Réponse / bounce / plainte / unsub → stop | `stopContactSequence`, process-event | R-07 PASS | **COMPLET+TESTÉ** | FAIL |
| Séquences ≤3 EMAIL J0/J+n | `planEmailSteps` | campaign-engine | **COMPLET+TESTÉ** | ABSENT |
| Scheduler SCHEDULED | BullMQ `campaign-scheduler` | Phase 4 | **COMPLET+TESTÉ** | ABSENT |
| Pause / resume / auto-pause | `pause-resume`, `auto-pause` | unit engine | **COMPLET+TESTÉ** | PARTIEL |
| Webhook signé + anti-replay | `signature.ts`, rate-limit | inbound tests | **COMPLET+TESTÉ** | FAIL |
| Unicité email contact | `email_normalized` unique partial | phase2-db / migration | **COMPLET+TESTÉ** | FAIL |
| RBAC 4 rôles | permissions + nav + API | nav-rbac + e2e | **COMPLET+TESTÉ** | PARTIEL |
| Observabilité health/files/DLQ/corr | `ops-health`, ALS | R-09 + Phase 6 | **COMPLET+TESTÉ** | PARTIEL |
| Export contacts/audit CSV safe | export routes + neutralize | R-10 PASS | **COMPLET+TESTÉ** | PARTIEL |
| Tâches commerciales | SalesTask + UI `/sales-tasks` | Phase 6 | **COMPLET+TESTÉ** | ABSENT |
| Assistant campagne 6 étapes | `/campaigns/new` + readiness | Phase 6 | **COMPLET** | ABSENT |
| IMAP inbound réel | stub adapter | — | **HORS V1 / stub** | ABSENT |
| UI arabe / IA | — | — | **HORS V1** | HORS V1 |
| SPF/DKIM gate technique | docs checklist | manuel | **MANUEL** | ABSENT |

---

## P0 — correction / test / preuve / doc

| ID | Correction | Test | Preuve | Doc |
|---|---|---|---|---|
| P0-1 | `process-event` → `stopContactSequence` | `inbound-process-event.test.ts` | 09 + Phase 3 | `05-PHASE-3` |
| P0-2 | `mustSimulateProviderSend` | `process-email-send`, R-04 | 03 + 09 | `03-PHASE-1` |
| P0-3 | `TEST_*_ALLOWLIST` | `send-gates`, R-04 | 03 + 09 | `03-PHASE-1` |
| P0-4 | migration unique partial | `phase2-db` (opt) + integrity | migration SQL | `04-PHASE-2` |
| P0-5 | HMAC webhook | `inbound-webhook-*` | Phase 3 | `05-PHASE-3` |
| P0-6 | `evaluateWorkerSendReadiness` | process-email-send, R-02 | 03 + 09 | `03-PHASE-1` |
| P0-7 | `planEmailSteps` + enqueue | `campaign-engine*.test.ts` | Phase 4 | `06-PHASE-4` |
| P0-8 | `scheduleCampaignStartJob` | campaign-engine FakeClock | Phase 4 | `06-PHASE-4` |
| P0-9 | CSV/XLSX exceljs + worker | imports-segments, R-01 | Phase 5 + 09 | `07-PHASE-5` |

**Verdict P0 : tous fermés.**

---

## R-01 → R-10 (recette)

| ID | Statut | Source |
|---|---|---|
| R-01…R-10 | **PASS** chacun | `09-TEST-EVIDENCE.json` (`globalResult: PASS`) |

---

## Régressions recherchées

| Zone | Résultat |
|---|---|
| Suite unitaire complète | 125 PASS — pas de régression détectée |
| TypeScript | PASS |
| Lint | 0 error / 0 warning (fixif `scripts/run-recette.mjs`) |
| Build | PASS (Phase 7) |
| E2E auth/RBAC routes | PASS |
| DRY_RUN / FakeMail | Conservé par défaut |

Aucune régression bloquante identifiée vs objectifs Phase 1–7.
