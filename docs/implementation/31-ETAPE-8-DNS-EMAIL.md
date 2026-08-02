# Étape 8 — DNS Email

Configurer SPF / DKIM / DMARC / rDNS sur un **domaine dédié**, puis vérifier
réputation, délivrabilité et spam score avant sortie de DRY_RUN.

---

## 1. Livrables

| Élément | Path |
|---|---|
| Guide ops enrichi | [docs/production/06-DNS.md](../production/06-DNS.md) |
| Checklist CLI | `npm run dns:checklist` → `docs/final-audit/dns-checklist.json` |
| Probe existant | `/ops/dns` · `src/lib/dns/*` |
| Phase technique | [12-PHASE-3-DNS.md](./12-PHASE-3-DNS.md) |

---

## 2. Config (rappel)

1. Domaine dédié (`mail.` / `noreply.`)
2. SPF unique + DKIM ESP + DMARC soft→hard + PTR
3. `SMTP_FROM_EMAIL` + `DKIM_SELECTORS`
4. `/ops/dns` → 0 CRITICAL

Le probe **n’ouvre pas** les gates d’envoi.

---

## 3. Vérifications externes

| Thème | Critère GO |
|---|---|
| Réputation | Blocklists clean · Postmaster/SNDS OK |
| Délivrabilité | Headers SPF/DKIM/DMARC pass · inbox |
| Spam score | mail-tester ≥ 8/10 |

```bash
npm run dns:checklist
DNS_CHECK_DOMAIN=mail.votredomaine.com npm run dns:checklist
```

---

## 4. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Guide domaine dédié | Réputation isolée | Inboxing ↑ | TTL DNS | Revenir records |
| Checklist CLI | Preuve avant prod | MTTD DNS ↓ | Lookups publics | — |
| Grille spam/réput | Critères GO explicites | Moins de surprises | Outils tiers | — |

---

## 5. Lien staging

Sur staging Mailpit, le DNS du From peut être sondé **sans** envoyer réel.
Utiliser `/ops/dns` + `dns:checklist` pendant Étape 7.
