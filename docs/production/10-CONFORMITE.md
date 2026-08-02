# Guide Conformité — CNDP / Loi 09-08

Complément ops de la Phase 13. Index : [README.md](./README.md).

---

## 1. Périmètre

La plateforme traite des données de prospection B2B (contacts écoles /
établissements). Cadre applicable : **Loi 09-08** et recommandations **CNDP**.

Responsable du traitement : voir `COMPLIANCE_CONTROLLER_NAME` /
`COMPLIANCE_DPO_EMAIL`.

---

## 2. UI & APIs

| Action | UI | API | Permission |
|---|---|---|---|
| Politique | `/compliance` | `GET /api/compliance/policy` | `compliance:read` |
| Créer demande | `/compliance` | `POST /api/compliance/requests` | `compliance:write` |
| Lister demandes | `/compliance` | `GET /api/compliance/requests` | `compliance:read` |
| Export sujet | `/compliance` | `GET /api/compliance/contacts/:id/export` | `compliance:export` |
| Anonymiser | `/compliance` | `POST …/anonymize` | `compliance:erase` |
| Legal hold | — | `POST …/legal-hold` | `compliance:retention` |
| Rétention | `/compliance` | `POST /api/compliance/retention/run` | `compliance:retention` |

---

## 3. Procédure demande personne concernée

1. Enregistrer la demande (type + email + notes) — échéance **30 j** par défaut
2. Vérifier l’identité hors-bande (process métier)
3. Lier le `contactId` si trouvé
4. Traiter :
   - Accès / export → télécharger JSON
   - Effacement → anonymiser (confirm `anonymize`)
   - Opposition → exclusion + stop (déjà couvert désinscription)
5. Clôturer la demande (`status=COMPLETED` + `resultSummary`)
6. Conserver la preuve dans l’audit module `compliance`

---

## 4. Anonymisation vs soft-delete

| Opération | Effet |
|---|---|
| Soft-delete contact | Masqué des listes — **PII encore en base** |
| Anonymisation | PII effacée, stub + exclusion GDPR |
| Legal hold | Bloque anonymisation (litige / obligation) |

Ne jamais promettre « suppression physique totale » des backups :
documenter la rétention backups ([07-BACKUP.md](./07-BACKUP.md)).

---

## 5. Conservation

Activer en prod seulement après validation juridique des délais :

```env
DATA_RETENTION_ENABLED=true
DATA_RETENTION_SOFT_DELETE_DAYS=90
DATA_RETENTION_EVENT_DAYS=365
DATA_RETENTION_AUDIT_DAYS=730
```

Toujours tester en `dryRun: true` avant exécution réelle.

Les logs `module=compliance` ne sont **pas** purgés automatiquement.

---

## 6. Journalisation

- Toute action conformité → `AuditLog` (ACCESS, EXPORT, ANONYMIZE, RETENTION, UPDATE)
- Enrichissement correlationId / requestId (Phase 5)
- Export audit ops : `/audit` + `audit:export`

---

## 7. Checklist conformité (extrait)

- [ ] DPO / contact CNDP renseigné
- [ ] Mentions information / désinscription dans templates
- [ ] Process demandes 30 j documenté
- [ ] Seed permissions après migrate
- [ ] Rétention validée juridiquement avant activation
- [ ] Exercice export + anonymisation sur staging
