# Étape 10 — Production contrôlée

Rampe de volume obligatoire :

**10 → 50 → 100 → 500 → 1000 → augmentation progressive**

Jamais directement plusieurs milliers d’emails.

---

## 1. Livrables

| Élément | Path |
|---|---|
| Playbook | [docs/production/12-PRODUCTION-CONTROLEE.md](../production/12-PRODUCTION-CONTROLEE.md) |
| Checklist CLI | `npm run ramp:checklist` → `docs/final-audit/production-ramp.json` |
| Journal | tableau dans le playbook §4 |

---

## 2. Quotas par palier (rappel)

| Palier | Jour | Heure | Campagne |
|---|---|---|---|
| R0 | 10 | 5 | 10 |
| R1 | 50 | 15 | 50 |
| R2 | 100 | 25 | 100 |
| R3 | 500 | 80 | 250 |
| R4 | 1000 | 150 | 500 |
| R5+ | +20–50 % / semaine max | prop. | ≤ day |

```bash
npm run ramp:checklist
# PowerShell: $env:RAMP_STAGE='R2'; npm run ramp:checklist
```

---

## 3. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Rampe chiffrée | Réputation / inboxing | Moins de blacklist | Pression métier | Rester palier / kill switch |
| CLI paliers | Ops alignés | Moins d’erreurs quotas | — | — |
| Journal | Audit pilot | Traçabilité | — | — |

Aucun script n’ouvre les gates — bascule manuelle uniquement.

---

## 4. Prérequis

Étape 7 staging · 8 DNS · 9 SMTP · checklist prod signée.
