# Docker Secrets (Phase 7)

Fichiers montés dans `/run/secrets/*` par Compose production/staging.

| Fichier | Variable runtime |
|---------|------------------|
| `postgres_password.txt` | `POSTGRES_PASSWORD` / `POSTGRES_PASSWORD_FILE` |
| `auth_secret.txt` | `AUTH_SECRET_FILE` |
| `webhook_secret.txt` | `WEBHOOK_SECRET_FILE` |
| `smtp_password.txt` | `SMTP_PASSWORD_FILE` |

```bash
npm run docker:secrets
# ou
node scripts/prepare-docker-secrets.mjs --force
```

Ne jamais committer les `*.txt` (gitignore).
