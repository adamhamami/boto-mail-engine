# Phase 8 — CI/CD (GitHub Actions)

Objectif : pipeline automatisé Build / Lint / Typecheck / Prisma / Tests /
Coverage / Docker Build / Docker Scan / npm audit / Release / Rollback.

---

## 1. Workflows

| Workflow | Fichier | Déclencheurs |
|---|---|---|
| **CI** | `.github/workflows/ci.yml` | `push`/`PR` sur `main`/`master`/`develop`, manuel |
| **Release** | `.github/workflows/release.yml` | tag `v*.*.*`, manuel |
| **Rollback** | `.github/workflows/rollback.yml` | manuel (+ confirmation) |

---

## 2. Jobs CI

```
quality ──► test ──┐
   │               ├──► ci-success
   └──► build ──► docker
audit ─────────────┘
```

| Job | Étapes |
|---|---|
| `quality` | `prisma validate` → `generate` → `migrate deploy` → `status` → `lint` → `typecheck` |
| `test` | `vitest --coverage` + artifact `coverage-report` |
| `audit` | rapport JSON + fail **critical** ; warn **high** (non bloquant) |
| `build` | `next build` (`SKIP_ENV_VALIDATION=1`) |
| `docker` | buildx app + worker, Trivy CRITICAL (fail), SARIF HIGH+ (artifact) |
| `ci-success` | gate finale |

Postgres 16 service pour les migrations Prisma en CI.

---

## 3. Release

```bash
git tag v1.0.0
git push origin v1.0.0
# ou Actions → Release → tag + dry_run optionnel
```

Publie sur GHCR :

```
ghcr.io/<owner>/<repo>/app:v1.0.0
ghcr.io/<owner>/<repo>/app:latest
ghcr.io/<owner>/<repo>/worker:v1.0.0
ghcr.io/<owner>/<repo>/worker:latest
```

Crée une GitHub Release avec notes générées + commandes de deploy.

---

## 4. Rollback

Actions → **Rollback** :

1. `environment` : `staging` | `production`
2. `target_tag` : ex. `v1.2.2`
3. `confirm` : `rollback`

Effet : retag GHCR `app/worker:<env>` → manifeste de `target_tag` (via `docker buildx imagetools create`).

Puis sur le serveur :

```bash
export APP_IMAGE=ghcr.io/<owner>/<repo>/app:production
export WORKER_IMAGE=ghcr.io/<owner>/<repo>/worker:production
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
```

Créer les GitHub Environments `staging` / `production` (Settings → Environments) pour les approvals optionnels.

---

## 5. Scripts npm

| Script | Usage CI |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:validate` | Prisma schema |
| `npm run db:migrate:deploy` | Migrations |
| `npm run test:coverage` | Vitest + seuils |
| `npm run audit:ci` | audit prod critical |

---

## 6. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| CI obligatoire | Qualité avant merge | PRs bloquées si rouge | Flaky docker/trivy | `continue-on-error` ciblé / désactiver job |
| Coverage seuils 20% | Empêcher régression forte | Fail si couverture chute | Trop bas aujourd’hui | Ajuster `vitest.config.ts` |
| Audit critical only | 11 high connus en deps | CI verte + visibilité | High non bloquant | Passer `audit-level=high` |
| Trivy CRITICAL | Images sans CVE critiques | Release/CI fail | Faux positifs | `ignore-unfixed` déjà on |
| GHCR release | Artefacts versionnés | Packages GitHub | Permissions packages | Dry-run release |

---

## 7. Validation locale

```bash
npm run lint
npm run typecheck
npm run db:validate
npm run test:coverage
npm run audit:ci
docker build -f Dockerfile --target app -t botoschool-app:ci .
docker build -f Dockerfile.worker -t botoschool-worker:ci .
```
