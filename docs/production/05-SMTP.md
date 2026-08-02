# Guide SMTP réel — Brevo · Mailgun · SES · SendGrid

Un seul chemin d’envoi : **Nodemailer + presets** (`MAIL_PROVIDER`).  
Les gates CDC restent strictes : `DRY_RUN` + `PRODUCTION_SENDING_ENABLED` + allowlist.

UI santé : `/ops/smtp` · Grafana SMTP · `/ops/monitoring`.

---

## 1. Principes

| Règle | Détail |
|---|---|
| Preset = hôte/port/TLS publics | Creds toujours `SMTP_USER` / `SMTP_PASSWORD` |
| Allowlist SSRF | `SMTP_HOST_ALLOWLIST` = hôte **résolu** (obligatoire si envoi réel) |
| Probe ≠ envoi | `/ops/smtp` fait EHLO/AUTH seulement — OK sous DRY_RUN |
| Kill switch | `PRODUCTION_SENDING_ENABLED=false` puis `DRY_RUN=true` + restart |

---

## 2. Configuration par fournisseur

Choisir **un** ESP. Remplacer domaine / secrets. Garder d’abord :

```env
DRY_RUN=true
PRODUCTION_SENDING_ENABLED=false
ALLOW_TEST_SMTP=false
SMTP_REQUIRE_TLS=true
```

### 2.1 Brevo

```env
MAIL_PROVIDER=brevo
SMTP_USER=compte@email.com
SMTP_PASSWORD=<SMTP key Brevo — pas la clé API v3>
SMTP_FROM_NAME="BotoSchool"
SMTP_FROM_EMAIL=noreply@mail.votredomaine.com
SMTP_HOST_ALLOWLIST=smtp-relay.brevo.com
# Quota UI (lecture seule) :
# BREVO_API_KEY=<clé API v3>
DKIM_SELECTORS=mail,brevo
```

Console : SMTP & API → générer **SMTP key**. Docs : [Brevo SMTP](https://developers.brevo.com/docs/send-a-transactional-email).

### 2.2 Mailgun

```env
MAIL_PROVIDER=mailgun
# US (défaut preset) :
# SMTP_HOST=smtp.mailgun.org
# EU :
SMTP_HOST=smtp.eu.mailgun.org
SMTP_USER=postmaster@mail.votredomaine.com
SMTP_PASSWORD=<SMTP password du domaine>
SMTP_FROM_EMAIL=noreply@mail.votredomaine.com
SMTP_HOST_ALLOWLIST=smtp.eu.mailgun.org
DKIM_SELECTORS=mxc,mxa
```

Domain settings → SMTP credentials. Mettre l’hôte **EU ou US** dans l’allowlist.

### 2.3 Amazon SES

```env
MAIL_PROVIDER=ses
SES_REGION=eu-west-1
# Hôte résolu = email-smtp.eu-west-1.amazonaws.com
SMTP_USER=<SMTP username IAM dérivé>
SMTP_PASSWORD=<SMTP password IAM dérivé>
SMTP_FROM_EMAIL=noreply@mail.votredomaine.com
SMTP_HOST_ALLOWLIST=email-smtp.eu-west-1.amazonaws.com
# Quota UI (lecture seule, pas les creds SMTP) :
# SES_ACCESS_KEY_ID=
# SES_SECRET_ACCESS_KEY=
DKIM_SELECTORS=  # Easy DKIM AWS — laisser vide ou sélecteurs Easy DKIM
```

Important : les identifiants **SMTP SES** ≠ Access Key IAM classiques.  
Créer via SES → SMTP settings. Sortir du sandbox SES avant volume.

### 2.4 SendGrid

```env
MAIL_PROVIDER=sendgrid
SMTP_USER=apikey
SMTP_PASSWORD=<API Key SendGrid avec Mail Send>
SMTP_FROM_EMAIL=noreply@mail.votredomaine.com
SMTP_HOST_ALLOWLIST=smtp.sendgrid.net
DKIM_SELECTORS=s1,s2
```

`SMTP_USER` doit être littéralement la chaîne `apikey`.

### 2.5 Postmark (bonus)

```env
MAIL_PROVIDER=postmark
SMTP_USER=<Server API Token>
SMTP_PASSWORD=<même Server API Token>
SMTP_HOST_ALLOWLIST=smtp.postmarkapp.com
```

---

## 3. Vérifications avant volume

1. DNS OK — [06-DNS.md](./06-DNS.md) · `npm run dns:checklist`
2. `/ops/smtp` → healthy (probe)
3. Allowlist contient l’hôte résolu
4. Worker up · Redis · ready
5. Campagne test + `TEST_EMAIL_ALLOWLIST` (si mode test)

```bash
npm run smtp:checklist
docker compose -f docker-compose.production.yml logs -f worker
```

---

## 4. Petits volumes (rampe)

> **Rampe officielle Étape 10** : [12-PRODUCTION-CONTROLEE.md](./12-PRODUCTION-CONTROLEE.md)  
> **10 → 50 → 100 → 500 → 1000 → progressif** — jamais plusieurs milliers d’un coup.

| Palier | Jour | Heure | Campagne | Durée min. |
|---|---|---|---|---|
| R0 | 10 | 5 | 10 | 2–4 h |
| R1 | 50 | 15 | 50 | 24 h |
| R2 | 100 | 25 | 100 | 24–48 h |
| R3 | 500 | 80 | 250 | 3–5 j |
| R4 | 1000 | 150 | 500 | 5–7 j |
| R5+ | +20–50 %/sem. | prop. | ≤ day | continu |

```bash
npm run ramp:checklist
```

```env
DRY_RUN=false
PRODUCTION_SENDING_ENABLED=true
# Ex. palier R2 :
SEND_QUOTA_PER_HOUR=25
SEND_QUOTA_PER_DAY=100
SEND_QUOTA_PER_CAMPAIGN=100
```

Redémarrer **app + worker** après chaque bascule de quotas.  
Ne jamais sauter de palier. Domaine neuf = durées doublées sur R0–R2.

---

## 5. Monitoring pendant l’envoi réel

Fenêtre critique : **30–60 min** après bascule, puis quotidien.

| Surface | Surveiller |
|---|---|
| `/ops/monitoring` `#alertes` `#erreurs` | bounce, failure, DLQ, worker |
| `/ops/smtp` | healthy, dryRun=false |
| Grafana SMTP | `botoschool_smtp_up`, débit, rates |
| Mailpit / ESP dashboard | acceptés / rejets |
| Logs worker | auth fail, timeout, rate limit ESP |

Seuils d’action immédiate :

| Signal | Action |
|---|---|
| Bounce &gt; `ALERT_BOUNCE_RATE_MAX` | Pause campagnes + section 6 |
| DLQ &gt; 0 | Inspecter jobs ; pause si massif |
| SMTP unhealthy | Kill switch |
| Worker stale | Restart worker ; si persiste → kill switch |

---

## 6. Rollback / kill switch (ordre strict)

1. **Couper l’envoi**
   ```env
   PRODUCTION_SENDING_ENABLED=false
   ```
2. **Revenir DRY_RUN**
   ```env
   DRY_RUN=true
   ```
3. **Redémarrer** app + worker (compose / process manager)
4. **Pause** campagnes RUNNING dans l’UI
5. **Révoquer** la clé SMTP / API côté ESP si suspicion de fuite
6. Vérifier `/ops` : dryRun=true, plus de jobs SENT réels
7. Journaliser l’incident ([03-INCIDENT.md](./03-INCIDENT.md))

Rollback config provider (sans couper les gates) :

```env
MAIL_PROVIDER=smtp
SMTP_HOST=...
# ou revenir au preset précédent + allowlist
```

---

## 7. Incidents SMTP

| Symptôme | Piste |
|---|---|
| Auth fail | User/pass / `apikey` SendGrid / SMTP SES vs IAM |
| Allowlist reject | Hôte résolu absent de `SMTP_HOST_ALLOWLIST` |
| Timeout | Egress 587/465, `SMTP_PROBE_TIMEOUT_MS` |
| TLS | `SMTP_REQUIRE_TLS`, STARTTLS |
| Quota ESP | Baisser `SEND_QUOTA_*` ; dashboard ESP |
| Sandbox SES | Vérifier destinataires / sortir sandbox |

---

## 8. Sécurité

- Secrets : env / `SMTP_PASSWORD_FILE` Docker — jamais Git
- Rotation : [SECRET-ROTATION.md](../runbooks/SECRET-ROTATION.md) § SMTP
- Pas de log password (redaction Pino)
- `disableFileAccess` / `disableUrlAccess` Nodemailer

---

## 9. Voir aussi

- [00-CHECKLIST.md](./00-CHECKLIST.md) § gates / rampe
- [06-DNS.md](./06-DNS.md)
- [11-STAGING.md](./11-STAGING.md) — valider d’abord en Mailpit
- [32-ETAPE-9-SMTP-REEL.md](../implementation/32-ETAPE-9-SMTP-REEL.md)
- Phase technique : [11-PHASE-2-SMTP-REEL.md](../implementation/11-PHASE-2-SMTP-REEL.md)
