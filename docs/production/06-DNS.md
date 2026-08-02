# Guide DNS Email — domaine dédié & délivrabilité

Configurer **SPF, DKIM, DMARC, Reverse DNS** sur un **domaine d’envoi dédié**,
puis vérifier réputation / délivrabilité / spam score **avant** de sortir de DRY_RUN.

UI probe : `/ops/dns` · détail technique : [12-PHASE-3-DNS.md](../implementation/12-PHASE-3-DNS.md).

---

## 1. Domaine dédié (recommandé)

| Mauvais | Bon |
|---|---|
| Envoyer depuis le domaine site corporate sans sous-domaine | `mail.botoschool.com` ou `noreply.botoschool.com` |
| Partager IP/réputation avec newsletters marketing massives | Séparer transactionnel / prospection si volume élevé |

1. Créer le sous-domaine chez le registrar.
2. Pointer `SMTP_FROM_EMAIL` vers ce domaine (ex. `noreply@mail.botoschool.com`).
3. Configurer l’ESP (Brevo, SES, Postmark…) pour ce domaine.
4. Appliquer les records ci-dessous.
5. Attendre propagation (TTL 5 min → 48 h).

---

## 2. Enregistrements

Remplacer `mail.votredomaine.com` et les valeurs fournies par l’ESP.

### SPF (TXT sur le domaine From)

```
v=spf1 include:<include-esp> -all
```

- **Un seul** SPF par nom.
- Préférer `-all` (fail) en prod après validation ; `~all` en rodage OK.

### DKIM

CNAME/TXT fournis par l’ESP :

```
selector._domainkey.mail.votredomaine.com → …
```

```env
DKIM_SELECTORS=selector
# multi : mail,brevo
```

### DMARC (TXT `_dmarc.mail.votredomaine.com`)

Phase soft :

```
v=DMARC1; p=none; rua=mailto:dmarc@votredomaine.com; pct=100; adkim=s; aspf=s
```

Puis durcir : `p=quarantine` → `p=reject` après revue des rapports RUA.

### MX

- Si le domaine reçoit du mail : MX valides.
- Si domaine **envoi-only** : null MX `0 .` acceptable (WARNING dans l’UI).

### Reverse DNS (PTR)

- Pointe vers le **hôte SMTP sortant** (souvent géré par l’ESP).
- Doit matcher le hostname HELO/EHLO déclaré.
- Hors contrôle registrar si IP ESP — demander au support ESP.

---

## 3. Variables

| Variable | Rôle |
|---|---|
| `SMTP_FROM_EMAIL` | Domaine analysé par `/ops/dns` |
| `DKIM_SELECTORS` | CSV sélecteurs |
| `DNS_HEALTH_CACHE_TTL_MS` | Cache rapport (défaut 300000) |
| `DNS_PROBE_TIMEOUT_MS` | Timeout lookup (défaut 5000) |
| `MAIL_PROVIDER` | Presets sélecteurs |
| `SMTP_HOST` / allowlist | Gates envoi réel (pas le probe DNS) |

Checklist auto (affichage) :

```bash
npm run dns:checklist
# optionnel : DNS_CHECK_DOMAIN=mail.votredomaine.com npm run dns:checklist
```

---

## 4. Procédure mise en place

1. Choisir domaine dédié + ESP
2. Publier SPF / DKIM / DMARC / MX / PTR
3. Attendre TTL
4. `/ops/dns` → **aucun CRITICAL**
5. Envoi test allowlist (staging réel ou prod contrôlée) → headers `Authentication-Results`
6. Checklist réputation / spam (section 5)
7. Seulement ensuite : checklist prod gates (`DRY_RUN=false`…)

Le probe DNS **ne bascule pas** les gates d’envoi.

---

## 5. Réputation · délivrabilité · spam score

Ces contrôles sont **manuels / externes** (pas automatisés dans l’app).

### Réputation

| Check | Outil / action |
|---|---|
| Blocklists IP/domaine | [MXToolbox Blacklist](https://mxtoolbox.com/blacklists.aspx), MultiRBL |
| Microsoft SNDS | Si IP Outlook/Hotmail |
| Google Postmaster Tools | Domaine From vérifié |
| Volume / plaintes | `/ops/monitoring` bounce + complaint rates |

Cibles : 0 listing critique ; plaintes ≪ 0.1 %.

### Délivrabilité

| Check | Action |
|---|---|
| Gmail / Outlook / Yahoo | Envoyer 3–5 messages allowlist |
| Headers | `spf=pass`, `dkim=pass`, `dmarc=pass` |
| Inbox vs spam | Noter le dossier ; corriger contenu / liens |
| Alignement | From domain = DKIM/SPF domain (strict DMARC) |

### Spam score

| Outil | Usage |
|---|---|
| [mail-tester.com](https://www.mail-tester.com/) | Envoyer 1 message → viser **≥ 8/10** |
| GlockApps / Litmus (option) | Placement inbox multi-FAI |
| Contenu | Éviter URL shorteners, pièces jointes.exe, SUBJECT spammy |

Grille GO DNS email :

| Critère | GO |
|---|---|
| `/ops/dns` | 0 CRITICAL |
| Auth headers test | SPF+DKIM+DMARC pass |
| mail-tester | ≥ 8/10 |
| Blocklists | IP/domaine clean |
| Postmaster / SNDS | Pas d’alerte rouge |

---

## 6. Interprétation UI `/ops/dns`

| Statut | Action |
|---|---|
| OK | Prêt côté DNS (sous réserve SMTP + gates) |
| WARNING | Corriger avant montée volume |
| CRITICAL / FAIL | **Ne pas** activer envoi réel |

---

## 7. Incidents

| Symptôme | Piste |
|---|---|
| SPF fail | Records multiples / include manquant |
| DKIM fail | Sélecteur / propagation / clé vide |
| DMARC fail | Alignement From |
| rDNS fail | PTR ESP |
| Spam folder | Contenu + réputation + volume neuf |
| Bounce storm | Pause campagne + kill switch gates |

---

## 8. Voir aussi

- [05-SMTP.md](./05-SMTP.md)
- [00-CHECKLIST.md](./00-CHECKLIST.md) § DNS
- [31-ETAPE-8-DNS-EMAIL.md](../implementation/31-ETAPE-8-DNS-EMAIL.md)
