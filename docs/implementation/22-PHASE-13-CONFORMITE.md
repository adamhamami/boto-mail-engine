# Phase 13 — Conformité (CNDP / Loi 09-08)

Objectif : préparer la plateforme pour les droits des personnes concernées —
traçabilité, export, suppression/anonymisation, conservation, journalisation —
**sans casser** les gates d’envoi ni la suppression opérationnelle existante.

---

## 1. Livrables

| Élément | Emplacement |
|---|---|
| Modèle demandes | `DataSubjectRequest` + champs `Contact.legalHold` / `anonymizedAt` |
| Migration | `prisma/migrations/20260801130000_phase13_compliance` |
| Services | `src/modules/compliance/services/*` |
| APIs | `/api/compliance/**` |
| UI | `/compliance` |
| Permissions | `compliance:*`, `contacts:export` |
| Rétention worker | `src/lib/compliance/retention-scheduler.ts` |
| Guide ops | [`docs/production/10-CONFORMITE.md`](../production/10-CONFORMITE.md) |

---

## 2. Mapping droits ↔ capacités

| Droit (Loi 09-08 / CNDP) | Capacité plateforme |
|---|---|
| Accès | Demande `ACCESS` + export JSON sujet |
| Portabilité | `GET /api/compliance/contacts/:id/export` |
| Rectification | Demande `RECTIFICATION` + édition contact existante |
| Effacement | Anonymisation (`compliance:erase`) |
| Opposition | Exclusion GDPR + stop séquence |
| Limitation | `legalHold` + demande `RESTRICTION` |
| Traçabilité | `AuditLog` module `compliance` (actions ACCESS/EXPORT/ANONYMIZE/RETENTION) |
| Conservation | Job rétention configurable (`DATA_RETENTION_*`) |

---

## 3. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Demandes DSR | Preuve de traitement des demandes | Process ops | Faible | Soft-disable UI |
| Export sujet | Portabilité | JSON complet | PII en fichier | Permission stricte |
| Anonymisation | Effacement pratique | Stub + exclusion GDPR | Irréversible | — (pas de rollback PII) |
| `contacts:export` | Séparer bulk ops / auditor | Auditor ne bulk-exporte plus | UI export contacts nécessite droit | Remettre `contacts:read` |
| Rétention | Durées de conservation | Purge events/audit | Perte historique | `DATA_RETENTION_ENABLED=false` |

---

## 4. Anonymisation — comportement

1. Stop séquence + exclusion `GDPR` (email **d’origine**)
2. Remplacement email → `anon-{hash}@anonymized.invalid`
3. Effacement PII (nom, téléphone, tags, customFields…)
4. Statut `BLOCKED`, `anonymizedAt` posé
5. Redaction `AuditLog` / `Event` IP-UA-metadata / sales summary
6. Journal `ANONYMIZE` (module compliance) — **non purgé** par rétention

`legalHold=true` bloque l’anonymisation (manuelle et auto).

---

## 5. Rétention

| Variable | Défaut | Effet |
|---|---|---|
| `DATA_RETENTION_ENABLED` | `false` | Active le job worker |
| `DATA_RETENTION_SOFT_DELETE_DAYS` | 90 | Soft-delete → anonymise |
| `DATA_RETENTION_EVENT_DAYS` | 365 | Purge `events` |
| `DATA_RETENTION_AUDIT_DAYS` | 730 | Purge audit hors `compliance` |
| `DATA_RETENTION_INTERVAL_MS` | 24h | Période leader |

API : `POST /api/compliance/retention/run` `{ confirm: "retention", dryRun: true|false }`.

---

## 6. Permissions

| Permission | Admin | Campaign mgr | Auditor |
|---|---|---|---|
| `compliance:read` | ✓ | ✓ | ✓ |
| `compliance:write` | ✓ | ✓ | ✓ |
| `compliance:export` | ✓ | — | ✓ |
| `compliance:erase` | ✓ | — | — |
| `compliance:retention` | ✓ | — | — |
| `contacts:export` | ✓ | ✓ | — |

Après migrate : `npm run db:seed` pour upsert les nouvelles permissions.

---

## 7. Commandes

```bash
npx prisma migrate deploy
npm run db:seed
npm run typecheck
npm run test
```
