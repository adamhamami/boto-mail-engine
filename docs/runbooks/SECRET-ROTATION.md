# Rotation des secrets — AUTH_SECRET / WEBHOOK_SECRET

## Pourquoi

Les JWT Auth.js sont signés avec `AUTH_SECRET`. Sans procédure de rotation, un secret compromis force une déconnexion massive ou un downtime.

## Procédure (zero-downtime JWT)

1. Générer un nouveau secret : `npm run secrets:generate` (ou `openssl rand -base64 32`).
2. Sur le serveur / Vercel :
   - `AUTH_SECRET_PREVIOUS=<valeur actuelle de AUTH_SECRET>`
   - `AUTH_SECRET=<nouveau secret>`
3. Redémarrer app + workers.
4. Attendre ≥ `AUTH_SESSION_MAX_AGE_SECONDS` (défaut 30 jours) **ou** forcer re-login après une fenêtre courte.
5. Retirer `AUTH_SECRET_PREVIOUS`.
6. Journaliser l’opération dans le runbook d’incident (qui / quand / ticket).

## WEBHOOK_SECRET

1. Déployer le nouveau secret côté app **et** côté émetteur de webhooks simultanément (fenêtre courte).
2. Pas de dual-key côté HMAC V1 — planifier une maintenance courte.
3. Vérifier `/api/ops/health` et logs `Webhook signature invalid` après bascule.

## SMTP_PASSWORD / secrets Docker

1. Générer un nouveau mot de passe côté provider SMTP.
2. Mettre à jour `./secrets/smtp_password.txt` (ou `SMTP_PASSWORD_FILE` / variable d’env).
3. Redémarrer **app + worker** pour recharger le fichier secret.
4. Valider via `/api/ops/smtp` (test forcé, RBAC settings:write) en DRY_RUN d’abord.

## Chiffrement applicatif (`enc:v1:`)

Les valeurs chiffrées via `encryptSecret` dépendent de `AUTH_SECRET`.
Lors d’une rotation, conserver `AUTH_SECRET_PREVIOUS` jusqu’à re-chiffrement des `AppSetting` secrets.

## Rollback

Remettre l’ancien `AUTH_SECRET` comme courant et vider `AUTH_SECRET_PREVIOUS`.
