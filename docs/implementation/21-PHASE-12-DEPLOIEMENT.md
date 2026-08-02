# Phase 12 — Déploiement

Objectif : packager la documentation **ops production** (install, rollback,
incident, monitoring, SMTP, DNS, backup, restore, runbook, checklist) et
consolider le template `.env.production.example`.

---

## 1. Livrables

| Élément | Emplacement |
|---|---|
| Index prod | [`docs/production/README.md`](../production/README.md) |
| Checklist | `docs/production/00-CHECKLIST.md` |
| Installation | `docs/production/01-INSTALLATION.md` |
| Rollback | `docs/production/02-ROLLBACK.md` |
| Incident | `docs/production/03-INCIDENT.md` |
| Monitoring | `docs/production/04-MONITORING.md` |
| SMTP | `docs/production/05-SMTP.md` |
| DNS | `docs/production/06-DNS.md` |
| Backup | `docs/production/07-BACKUP.md` |
| Restore | `docs/production/08-RESTORE.md` |
| Runbook | `docs/production/09-RUNBOOK.md` |
| Env template | [`.env.production.example`](../../.env.production.example) |

---

## 2. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Suite `docs/production/` | Ops dispersée (Deployment, phases, pilot) | Onboarding & incidents plus rapides | Doc à maintenir | Supprimer dossier (code inchangé) |
| `.env.production.example` | Aligné phases 6–11 | Template complet | — | Git history |
| Liens README / Deployment | Découvrabilité | Navigation | — | Revert liens |

Aucune modification runtime / API / migrations dans cette phase documentation.

---

## 3. Utilisation

```text
Nouveau serveur     → 01-INSTALLATION + 00-CHECKLIST
Release             → 09-RUNBOOK § Déploiement + 02-ROLLBACK sous le coude
Alerte monitoring   → 04-MONITORING → 03-INCIDENT
SMTP / DNS          → 05 / 06 avant DRY_RUN=false
Backup quotidien    → 07 (+ cron)
Disaster recovery   → 08 (staging d’abord)
```

---

## 4. Liens connexes

- [`../Deployment.md`](../Deployment.md) — chemins Docker / Vercel
- Phases 7–11 — Docker, CI/CD, deps, backup, perf
- [`../runbooks/SECRET-ROTATION.md`](../runbooks/SECRET-ROTATION.md)
- [`../final-audit/04-PILOT-CHECKLIST.md`](../final-audit/04-PILOT-CHECKLIST.md)
