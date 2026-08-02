# Production contrôlée — rampe de volume

**Jamais** envoyer plusieurs milliers d’emails d’un coup sur un domaine neuf
ou une première ouverture réelle.

Rampe obligatoire :

```
10 → 50 → 100 → 500 → 1000 → augmentation progressive
```

Gates : `DRY_RUN=false` + `PRODUCTION_SENDING_ENABLED=true` uniquement après
[00-CHECKLIST.md](./00-CHECKLIST.md) + DNS + SMTP GO.

Kill switch : [05-SMTP.md](./05-SMTP.md) §6.

---

## 1. Tableau de rampe (quotas recommandés)

| Palier | Volume cible / jour | `SEND_QUOTA_PER_DAY` | `SEND_QUOTA_PER_HOUR` | `SEND_QUOTA_PER_CAMPAIGN` | Durée min. | GO vers suivant |
|---|---|---|---|---|---|---|
| **R0** Allowlist | 10 | `10` | `5` | `10` | 2–4 h | 10 SENT, 0 hard bounce, SMTP OK |
| **R1** | 50 | `50` | `15` | `50` | 24 h | bounce &lt; 3 %, failure &lt; 5 %, DLQ 0 |
| **R2** | 100 | `100` | `25` | `100` | 24–48 h | idem + plaintes ≈ 0 |
| **R3** | 500 | `500` | `80` | `250` | 3–5 j | bounce &lt; 2 %, monitoring vert |
| **R4** | 1000 | `1000` | `150` | `500` | 5–7 j | idem + Postmaster/SNDS OK |
| **R5+** | Progressif | +20–50 % / semaine max | proportionnel | ≤ day | continu | jamais ×5 en une fois |

Règles dures :

1. **Ne pas sauter** un palier (ex. R0 → R3 interdit).
2. **Ne pas** passer de 100 à 1000 en une journée.
3. Si un critère GO échoue → **rester** ou **descendre** d’un palier + kill switch si critique.
4. Domaine / IP neufs : doubler les durées min. des paliers R0–R2.

```bash
npm run ramp:checklist
# PowerShell : $env:RAMP_STAGE='R2'; npm run ramp:checklist
```

---

## 2. Procédure par palier

### Avant R0

- [ ] Staging OK ([11-STAGING.md](./11-STAGING.md))
- [ ] DNS GO ([06-DNS.md](./06-DNS.md))
- [ ] SMTP probe OK ([05-SMTP.md](./05-SMTP.md))
- [ ] Checklist prod signée
- [ ] Worker + ready OK
- [ ] Campagne **VALIDATED**, destinataires allowlist / petit segment

### Bascule gates (une fois)

```env
DRY_RUN=false
PRODUCTION_SENDING_ENABLED=true
```

Redémarrer app + worker. Puis appliquer les quotas du palier courant.

### Pendant chaque palier

1. Appliquer les 3 quotas du tableau
2. Redémarrer worker (et app si env montée dans le process)
3. Lancer **une** campagne / segment borné ≤ quota jour
4. Surveiller **30–60 min** puis quotidien :
   - `/ops/monitoring` `#erreurs` `#alertes` `#workers` `#smtp`
   - Grafana SMTP / Erreurs
   - Dashboard ESP
5. Remplir le journal §4
6. Cocher GO → palier suivant **ou** rollback

### Interdit

- Importer 10k contacts et tout programmer le jour J
- Monter `SEND_QUOTA_PER_DAY` à 5000 « pour voir »
- Désactiver les alertes bounce pour « passer »
- Skip R3 parce que « le client veut du volume »

---

## 3. Monitoring & seuils d’arrêt

| Signal | Action |
|---|---|
| Hard bounce &gt; 3 % (R0–R2) ou &gt; 2 % (R3+) | Pause campagne + descendre palier |
| Failure rate &gt; 5 % | Pause + `/ops/smtp` |
| DLQ &gt; 0 massif | Kill switch |
| Plaintes / spam reports | Kill switch + revue contenu |
| Worker stale / SMTP KO | Kill switch |
| Blocklist nouvelle | Kill switch + DNS/ESP |

Kill switch ordre :

1. `PRODUCTION_SENDING_ENABLED=false`
2. `DRY_RUN=true`
3. Restart app + worker
4. Pause campagnes RUNNING
5. Journal incident

---

## 4. Journal de rampe (à conserver)

| Date | Palier | Quota jour | Envoyés | Bounce % | Failure % | DLQ | Décision | Signataire |
|---|---|---|---|---|---|---|---|---|
| | R0 | 10 | | | | | GO / HOLD / DOWN | |
| | R1 | 50 | | | | | | |
| | R2 | 100 | | | | | | |
| | R3 | 500 | | | | | | |
| | R4 | 1000 | | | | | | |
| | R5+ | … | | | | | | |

---

## 5. Exemples d’env par palier

### R0 — 10 emails

```env
SEND_QUOTA_PER_HOUR=5
SEND_QUOTA_PER_DAY=10
SEND_QUOTA_PER_CAMPAIGN=10
```

### R1 — 50

```env
SEND_QUOTA_PER_HOUR=15
SEND_QUOTA_PER_DAY=50
SEND_QUOTA_PER_CAMPAIGN=50
```

### R2 — 100

```env
SEND_QUOTA_PER_HOUR=25
SEND_QUOTA_PER_DAY=100
SEND_QUOTA_PER_CAMPAIGN=100
```

### R3 — 500

```env
SEND_QUOTA_PER_HOUR=80
SEND_QUOTA_PER_DAY=500
SEND_QUOTA_PER_CAMPAIGN=250
```

### R4 — 1000

```env
SEND_QUOTA_PER_HOUR=150
SEND_QUOTA_PER_DAY=1000
SEND_QUOTA_PER_CAMPAIGN=500
```

### R5+ — progressif

Augmenter **au plus** ~20–50 % du quota jour par semaine si tous les GO sont verts.
Plafond = capacité ESP + réputation (Postmaster / SNDS), pas le souhait métier.

---

## 6. Voir aussi

- [05-SMTP.md](./05-SMTP.md) — providers + kill switch
- [04-MONITORING.md](./04-MONITORING.md)
- [09-RUNBOOK.md](./09-RUNBOOK.md)
- [33-ETAPE-10-PRODUCTION-CONTROLEE.md](../implementation/33-ETAPE-10-PRODUCTION-CONTROLEE.md)
- Pilote : [04-PILOT-CHECKLIST.md](../final-audit/04-PILOT-CHECKLIST.md)
