# Étape 9 — SMTP réel

Configurer Brevo / Mailgun / Amazon SES / SendGrid via presets Nodemailer,
puis rampe **petits volumes**, **monitoring**, **rollback**.

---

## 1. Livrables

| Élément | Path |
|---|---|
| Guide multi-ESP | [docs/production/05-SMTP.md](../production/05-SMTP.md) |
| Checklist CLI | `npm run smtp:checklist` → `docs/final-audit/smtp-checklist.json` |
| Presets code | `src/lib/mail/providers.ts` (inchangé — déjà complet) |
| Santé | `/ops/smtp` · Grafana SMTP |
| Phase technique | [11-PHASE-2-SMTP-REEL.md](./11-PHASE-2-SMTP-REEL.md) |

---

## 2. Config rapide

Exemple Brevo (voir [05-SMTP.md](../production/05-SMTP.md) pour Mailgun / SES / SendGrid) :

```env
MAIL_PROVIDER=brevo
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_HOST_ALLOWLIST=smtp-relay.brevo.com
DRY_RUN=true
PRODUCTION_SENDING_ENABLED=false
```

```bash
npm run smtp:checklist
# bash: SMTP_CHECK_PROVIDER=brevo npm run smtp:checklist
# PowerShell: $env:SMTP_CHECK_PROVIDER='brevo'; npm run smtp:checklist
```

Prérequis : Étape 8 DNS GO · staging Mailpit OK (Étape 7).

---

## 3. Petits volumes → monitoring → rollback

| Phase | Action |
|---|---|
| Volumes | Quotas 5→20→50/h (voir §4 de 05-SMTP) |
| Monitoring | 30–60 min `/ops/monitoring` + Grafana ; seuils bounce/DLQ |
| Rollback | `PRODUCTION_SENDING_ENABLED=false` → `DRY_RUN=true` → restart → pause → révoquer clé |

**Aucun script n’active l’envoi réel** — bascule manuelle + checklist signée ([00-CHECKLIST.md](../production/00-CHECKLIST.md)).

---

## 4. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Guide 4 ESP | Onboarding ops | Moins d’erreurs creds | Mauvais allowlist | Kill switch §6 |
| Rampe quotas | Réputation domaine | Inboxing ↑ | Volume trop vite | Baisser quotas / kill |
| Checklist CLI | Preuve avant GO | Audit | — | — |

---

## 5. Non-objectifs (volontaires)

- Pas de SDK HTTP par ESP (un seul chemin SMTP)
- Pas d’affaiblissement DRY_RUN / allowlists
- Pas de `MAILGUN_*` / `SENDGRID_*` send creds (SMTP_USER/PASSWORD)
