# Baseline — BotoSchool Emailing

Source : `docs/audit-emailing/AUDIT-COMPLET.md` (2026-07-27) + CDC V1.0.

## Décision audit

**NO-GO** — score ~50/100 — plusieurs P0 ouverts.

## P0 ciblés Phase 1 (sécurisation envois)

| ID | Anomalie |
|----|----------|
| P0-2 | Mode test contourne `DRY_RUN` (SMTP réel) |
| P0-3 | Allowlist test = booléen `isTestRecipient` |
| P0-6 | Worker sans revalidation complète avant SMTP |
| S-06 | `AUTH_SECRET` avec défaut dangereux |
| R-05 | Contrôles production incomplets avant SMTP réel |

## Hors Phase 1

Séquences multi-étapes, webhooks signés, scheduler `SCHEDULED`, import CSV/XLSX UI, `Contact.email` unique DB.
