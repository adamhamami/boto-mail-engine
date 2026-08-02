# Checklist Production

À cocher **avant** ouverture utilisateurs et **avant** tout envoi SMTP réel.
Signer en bas (date / responsable).

---

## 1. Prérequis infra

- [ ] Serveur / VMs dimensionnés (CPU/RAM disk pour Postgres + Redis + backups)
- [ ] Docker Engine + Compose installés
- [ ] Reverse proxy TLS (cert valide, HSTS)
- [ ] Postgres **non** exposé publiquement
- [ ] Redis **non** exposé publiquement
- [ ] Pare-feu : seuls 80/443 (et SSH admin) ouverts
- [ ] NTP / timezone serveur cohérente (`Africa/Casablanca` métier)

---

## 2. Configuration & secrets

- [ ] `.env` dérivé de `.env.production.example` (jamais commit)
- [ ] `npm run secrets:generate` → `AUTH_SECRET`, `WEBHOOK_SECRET` forts
- [ ] `POSTGRES_PASSWORD` unique (≠ défaut)
- [ ] Secrets Docker : `npm run docker:secrets` (`./secrets/*.txt`)
- [ ] `APP_URL` / `AUTH_URL` = URL HTTPS publique exacte
- [ ] Mot de passe admin changé (`npm run admin:password "..."`)
- [ ] Comptes rôles séparés (ADMIN / CAMPAIGN_MANAGER / SALES / AUDITOR)
- [ ] Aucun secret dans logs, tickets, captures d’écran

---

## 3. Déploiement applicatif

- [ ] Image / tag versionné (`vX.Y.Z` GHCR ou build local)
- [ ] `prisma migrate deploy` OK
- [ ] Seed initial (une seule fois) + admin
- [ ] Worker démarré (`WORKER_ENABLED=true`, réplicas si HA)
- [ ] `GET /api/health/live` → 200
- [ ] `GET /api/health/ready` → DB + Redis OK
- [ ] Login UI OK
- [ ] Pages `/ops`, `/ops/smtp`, `/ops/dns`, `/ops/monitoring` accessibles (`ops:read`)

---

## 4. SMTP / DNS (avant envoi réel)

- [ ] `MAIL_PROVIDER` + credentials SMTP configurés
- [ ] `SMTP_HOST_ALLOWLIST` = hôte **résolu**
- [ ] `SMTP_REQUIRE_TLS=true`
- [ ] Probe `/ops/smtp` OK (verify)
- [ ] SPF / DKIM / DMARC / MX documentés (voir [06-DNS.md](./06-DNS.md))
- [ ] Probe `/ops/dns` sans statut CRITICAL
- [ ] Allowlist test renseignée si besoin (`TEST_EMAIL_ALLOWLIST`)

---

## 5. Gates CDC (état initial sûr)

- [ ] `DRY_RUN=true`
- [ ] `PRODUCTION_SENDING_ENABLED=false`
- [ ] `ALLOW_TEST_SMTP=false`
- [ ] Quotas bas prêts pour la bascule (`SEND_QUOTA_*`)
- [ ] Fenêtre d’envoi métier configurée (`SEND_WINDOW_*`)

---

## 6. Observabilité & backup

- [ ] Logs JSON stdout (ou fichiers) collectés
- [ ] Alertes monitoring calibrées (`ALERT_*`)
- [ ] Heartbeat worker visible
- [ ] Backup automatique planifié (cron / Task Scheduler)
- [ ] `backup:verify` OK sur un snapshot récent
- [ ] Restore **testé sur staging** au moins une fois
- [ ] Rotation backups (`BACKUP_RETENTION_*`)

---

## 7. Sécurité applicative

- [ ] CSP activée (`CSP_ENABLED=true`)
- [ ] Rate-limit login + API (`RATE_LIMIT_STORE=redis` en multi-instance)
- [ ] `npm audit` / `npm run audit:ci` OK ou revue acceptée
- [ ] Webhooks signés (`WEBHOOK_SECRET`)
- [ ] Plan rotation secrets connu ([SECRET-ROTATION](../runbooks/SECRET-ROTATION.md))

---

## 8. Conformité CNDP / Loi 09-08

- [ ] `COMPLIANCE_CONTROLLER_NAME` / `COMPLIANCE_DPO_EMAIL` renseignés
- [ ] Migration Phase 13 + `npm run db:seed` (permissions `compliance:*`)
- [ ] Page `/compliance` accessible (admin / auditor)
- [ ] Process demandes 30 j documenté ([10-CONFORMITE.md](./10-CONFORMITE.md))
- [ ] Exercice export sujet + anonymisation sur **staging**
- [ ] `DATA_RETENTION_ENABLED` laissé `false` jusqu’à validation juridique des délais
- [ ] Mentions information / lien désinscription dans templates

---

## 9. Recette & pilote

- [ ] Recette R-01…R-10 PASS (staging)
- [ ] Pilote technique DRY_RUN / Mailpit OK
- [ ] Checklist pilote ([04-PILOT-CHECKLIST](../final-audit/04-PILOT-CHECKLIST.md))
- [ ] GO écrit pour SMTP réel (juridique + produit + ops)

---

## 10. Bascule envoi réel (séparée — ne pas cocher le jour J install)

Suivre la **rampe Étape 10** : [12-PRODUCTION-CONTROLEE.md](./12-PRODUCTION-CONTROLEE.md)  
(`npm run ramp:checklist`) — **10 → 50 → 100 → 500 → 1000 → progressif**.

- [ ] Backup frais immédiatement avant
- [ ] `DRY_RUN=false` + `PRODUCTION_SENDING_ENABLED=true`
- [ ] Quotas **R0** d’abord (`SEND_QUOTA_PER_DAY=10`, hour=5, campaign=10)
- [ ] Campagne test allowlist ≤ 10 → contrôle boîte + events
- [ ] Monitoring DLQ / bounce 30–60 min puis palier suivant si GO
- [ ] Journal de rampe rempli (playbook §4)
- [ ] **Interdit** : sauter un palier ou passer directement à plusieurs milliers
- [ ] Plan rollback / kill switch à portée de main ([05-SMTP.md](./05-SMTP.md) §6)

---

## Signature

| Champ | Valeur |
|---|---|
| Environnement | production / staging |
| Date | |
| Responsable ops | |
| Responsable produit | |
| Décision | GO / NO-GO / GO CONDITIONNEL |
| Commentaire | |
