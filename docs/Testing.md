# Tests — BotoSchool Email Platform

## Stack de test

| Outil | Usage |
|-------|-------|
| **Vitest** | Tests unitaires et d'intégration |
| **Playwright** | Tests E2E (navigateur) |
| **Testing Library** | Tests composants React |

## Structure

```
tests/
├── unit/              # Tests unitaires (services, validators)
├── integration/       # Tests API routes + DB
├── e2e/               # Tests Playwright
└── fixtures/          # Données de test
```

## Commandes

```bash
# Tests unitaires
npm run test

# Tests unitaires en watch
npm run test:watch

# Coverage
npm run test:coverage

# Tests E2E
npm run test:e2e

# Tests E2E avec UI
npm run test:e2e:ui
```

## Conventions

### Nommage

```
{module}.service.test.ts      # Test service
{module}.validator.test.ts    # Test validator
{module}.repository.test.ts   # Test repository
{page}.spec.ts                # Test E2E Playwright
```

### Tests unitaires

- Mock Prisma via `@/lib/db/prisma`
- Mock Redis/BullMQ pour les tests queue
- Pas de dépendance réseau

### Tests d'intégration

- Base de test PostgreSQL dédiée
- Reset entre chaque test suite
- Seed minimal

### Tests E2E

- Playwright avec authentification pré-configurée
- Screenshots on failure
- Tests des workflows critiques :
  1. Login → Dashboard
  2. Import CSV → Contacts
  3. Créer campagne → Valider → Vérifier statut
  4. Export audit

## CI/CD (recommandé)

```yaml
# .github/workflows/test.yml
jobs:
  unit:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
      redis:
        image: redis:7-alpine
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npm run test

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright install
      - run: npm run test:e2e
```

## Couverture cible

| Couche | Cible |
|--------|-------|
| Services | ≥ 80% |
| Validators | ≥ 90% |
| Repositories | ≥ 70% |
| E2E workflows | 100% des parcours critiques |
