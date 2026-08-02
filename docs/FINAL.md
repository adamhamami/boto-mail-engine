# Documentation finale — BotoSchool Email Platform v1.0.0

Point d’entrée unique pour la version **1.0.0**.

---

## 1. Démarrage rapide

| Public | Document |
|---|---|
| Développeur | [guides/DEVELOPER.md](./guides/DEVELOPER.md) |
| Administrateur | [guides/ADMIN.md](./guides/ADMIN.md) |
| Opérateur | [guides/OPERATOR.md](./guides/OPERATOR.md) |
| Production | [production/README.md](./production/README.md) |

---

## 2. Architecture & données

| Doc | Contenu |
|---|---|
| [Architecture.md](./Architecture.md) | Système, déploiement, séquence d’envoi |
| [Database.md](./Database.md) | Modèle de données |
| [API.md](./API.md) | Surfaces API |
| [Testing.md](./Testing.md) | Tests |
| [Recette.md](./Recette.md) | Critères CDC R-01…R-10 |

---

## 3. Mise en production (parcours)

```
Staging (7) → DNS (8) → SMTP (9) → Rampe 10…1000 (10) → Release 1.0 (11)
```

| Étape | Doc | Commande clé |
|---|---|---|
| 7 Staging | [production/11-STAGING.md](./production/11-STAGING.md) | `npm run deploy:staging` · `smoke:staging` |
| 8 DNS | [production/06-DNS.md](./production/06-DNS.md) | `npm run dns:checklist` |
| 9 SMTP | [production/05-SMTP.md](./production/05-SMTP.md) | `npm run smtp:checklist` |
| 10 Volume | [production/12-PRODUCTION-CONTROLEE.md](./production/12-PRODUCTION-CONTROLEE.md) | `npm run ramp:checklist` |
| 11 Release | [releases/v1.0.0.md](./releases/v1.0.0.md) | tag `v1.0.0` |

Checklist GO : [production/00-CHECKLIST.md](./production/00-CHECKLIST.md).

---

## 4. Sauvegarde & images Docker

### Backup (avant tag / bascule)

```bash
npm run backup -- --compose=docker-compose.production.yml
npm run backup:verify
```

Guide : [production/07-BACKUP.md](./production/07-BACKUP.md).

### Images Docker v1.0.0

```bash
# Build taggés localement
docker build -f Dockerfile --target app -t botoschool-app:1.0.0 -t botoschool-app:v1.0.0 .
docker build -f Dockerfile.worker --target worker -t botoschool-worker:1.0.0 -t botoschool-worker:v1.0.0 .

# Ou via compose prod
APP_IMAGE=botoschool-app:1.0.0 WORKER_IMAGE=botoschool-worker:1.0.0 npm run docker:prod

# GHCR (si CI Release)
# ghcr.io/<org>/botoschool-app:v1.0.0
# ghcr.io/<org>/botoschool-worker:v1.0.0
```

Procédure détaillée : [implementation/34-ETAPE-11-VERSION-1.0.md](./implementation/34-ETAPE-11-VERSION-1.0.md).

---

## 5. Gates CDC (rappel)

| Variable | Défaut sûr |
|---|---|
| `DRY_RUN` | `true` |
| `PRODUCTION_SENDING_ENABLED` | `false` |

Rampe volume : **10 → 50 → 100 → 500 → 1000 → progressif**.

---

## 6. Observabilité

- Health : `/api/health/live` · `/api/health/ready`
- Ops : `/ops` · `/ops/monitoring` · `/ops/smtp` · `/ops/dns`
- Stack : `npm run docker:monitoring`

---

## 7. Historique étapes d’implémentation

Voir `docs/implementation/` (phases 0–14 + étapes 2–11).
