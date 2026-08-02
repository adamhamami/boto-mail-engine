# BotoSchool — Plateforme de Prospection Email

Plateforme interne d'automatisation de prospection email pour BotoSchool.

## Fonctionnalités

- Import CSV/XLSX de contacts
- Gestion des organisations et contacts
- Détection des doublons et qualification
- Segmentation dynamique
- Modèles d'emails et séquences
- Campagnes avec **validation obligatoire** avant envoi
- Envoi asynchrone via BullMQ
- Gestion des réponses, rebonds et désinscriptions
- Dashboard KPIs et audit complet
- RBAC (4 rôles)

## Stack

| Couche | Technologie |
|--------|-------------|
| Frontend | Next.js 16, React 19, TailwindCSS, shadcn/ui |
| Backend | API Routes Next.js |
| Base de données | PostgreSQL + Prisma 7 |
| Queue | Redis + BullMQ |
| Auth | Auth.js (NextAuth v5) |
| Emails | Nodemailer (SMTP abstrait) |
| Tests | Vitest + Playwright |

## Démarrage rapide

### Prérequis

- Node.js 20+
- Docker & Docker Compose

### Installation

```bash
# Cloner et installer
npm install

# Copier la configuration
cp .env.example .env

# Démarrer PostgreSQL et Redis
docker compose up postgres redis -d

# Générer le client Prisma et migrer
npx prisma generate
npx prisma migrate dev

# Seed (rôles, permissions, admin)
npm run db:seed

# Lancer l'app + le worker (2 terminaux)
npm run dev
npm run worker
```

> PostgreSQL Docker est exposé sur le port **5433** (évite le conflit avec un Postgres local sur 5432).  
> Mailpit (SMTP local) : `npm run docker:tools` → UI http://localhost:8025

### Compte admin

Après seed, changez immédiatement le mot de passe :

```bash
npm run admin:password "VotreMotDePasseFort12"
```

Les secrets générés sont dans `.credentials.local` (gitignored). Voir [docs/Deployment.md](docs/Deployment.md).

## Scripts

| Commande | Description |
|----------|-------------|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build production |
| `npm run start` | Démarrer en production |
| `npm run worker` | Démarrer le worker BullMQ |
| `npm run test` | Tests unitaires (Vitest) |
| `npm run test:e2e` | Tests E2E (Playwright) |
| `npm run db:migrate` | Migrations Prisma |
| `npm run db:seed` | Seed de la base |
| `npm run db:studio` | Prisma Studio |
| `npm run docker:up` | Postgres + Redis |
| `npm run docker:tools` | Mailpit (SMTP local) |
| `npm run docker:prod` | Stack Docker production |
| `npm run secrets:generate` | Générer secrets → `.credentials.local` |
| `npm run admin:password` | Changer le mot de passe admin |
| `npm run deploy:docker` | Deploy Docker (Windows) |

## Architecture

Voir [docs/Architecture.md](docs/Architecture.md)

## Documentation

- [**Documentation finale v1.0.0**](docs/FINAL.md)
- [**Release Notes v1.0.0**](docs/releases/v1.0.0.md)
- [**Guides**](docs/guides/README.md) — développeur · administrateur · opérateur
- [Architecture](docs/Architecture.md) — diagrammes + séquence d’envoi
- [API](docs/API.md)
- [Base de données](docs/Database.md)
- [Déploiement](docs/Deployment.md)
- [**Staging**](docs/production/11-STAGING.md) — `npm run deploy:staging` · `npm run smoke:staging`
- [**DNS Email**](docs/production/06-DNS.md) — `npm run dns:checklist`
- [**SMTP réel**](docs/production/05-SMTP.md) — Brevo/Mailgun/SES/SendGrid · `npm run smtp:checklist`
- [**Production contrôlée**](docs/production/12-PRODUCTION-CONTROLEE.md) — rampe 10→50→100→500→1000 · `npm run ramp:checklist`
- [**Production (ops)**](docs/production/README.md) — install, rollback, incident, monitoring, SMTP, DNS, backup, restore, runbook, checklist, conformité CNDP
- [**Validation finale (Phase 14)**](docs/final-audit/PHASE-14-VALIDATION-REPORT.md) — `npm run validate:final`
- [**Release Candidate**](docs/final-audit/RELEASE-CANDIDATE.md)
- [Étape 6 — Documentation](docs/implementation/29-ETAPE-6-DOCUMENTATION.md)
- [Tests](docs/Testing.md)

## Sécurité

- RBAC avec 4 rôles
- Validation Zod sur toutes les entrées
- Rate limiting
- Headers de sécurité (Helmet-equivalent)
- Protection CSRF
- Audit complet de toutes les actions
- Aucun envoi sans validation de campagne

## Licence

Propriétaire — BotoSchool © 2026
