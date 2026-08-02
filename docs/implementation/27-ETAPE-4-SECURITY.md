# Étape 4 — Hardening sécurité

Revue ciblée (Phase 1 déjà en place) + gaps comblés. **Sans toucher** RBAC / gates `DRY_RUN` / `PRODUCTION_SENDING_ENABLED`.

---

## 1. Checklist

| Domaine | État | Preuve |
|---|---|---|
| Headers HTTP | OK | Middleware + `next.config` (CSP partagée) + `vercel.json` aligné |
| CSP | OK | Enforce par défaut ; `CSP_REPORT_ONLY` ; prod sans `unsafe-eval` |
| CSRF | OK | Fail-closed Origin / Sec-Fetch-Site (API mutantes) |
| XSS | OK | `escapeHtml` templates + aperçu iframe `sandbox` + `sanitizePreviewHtml` |
| Injections SQL | OK | Prisma tagué uniquement (pas de `$queryRawUnsafe`) |
| Rate limiting | OK | login+IP, API auth, unsubscribe, webhook, SMTP/DNS tests |
| Validation Zod | OK | CRUD + body DNS + token unsubscribe |
| Secrets | OK | Zod env, `*_FILE`, validate-env, gitignore |
| Rotation clés | OK | `docs/runbooks/SECRET-ROTATION.md` (+ SMTP) |
| Permissions Docker | OK | USER non-root + `cap_drop` / `no-new-privileges` / `read_only` |

---

## 2. Gaps comblés (cette étape)

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| `login-ip` branché | Bruteforce multi-comptes | Bucket IP login | Proxy mal configuré → faux positifs | Retirer branche IP |
| RL API via `requireAuth` | Env `RATE_LIMIT_*` inutilisé | 429 si abus | Tests charge | Monter `RATE_LIMIT_MAX_REQUESTS` |
| RL unsubscribe | Surface publique | Anti-spam token | 429 légitimes | Monter profil `unsubscribe` |
| Zod DNS POST | Cast `as` | Validation stricte | Corps vide toujours OK | — |
| Preview iframe + sanitize | XSS auteur template | Scripts bloqués | Styles limités | Remettre div |
| CSP unique | Duplication next/middleware | Une source de vérité | — | — |
| Docker harden | Conteneur root-like | Surface ↓ | `read_only` + volumes | Retirer flags |
| vercel.json headers | Incomplete vs Next | Défense en profondeur Vercel | — | — |

---

## 3. Résidu accepté (backlog)

- CSP `unsafe-inline` (scripts/styles) — nonces Next plus tard
- WEBHOOK_SECRET sans dual-key (runbook maintenance)
- `npm audit` processus Phase 9 (pas bloquant ici)

---

## 4. Commandes

```bash
npm run typecheck
npx vitest run tests/unit/prod-security-phase1.test.ts
npm run env:validate
```

---

## 5. Fichiers clés

- `src/lib/security/security-headers.ts` / `html-preview.ts`
- `src/lib/api/auth-guard.ts` / `rate-limit.ts`
- `src/lib/auth/index.ts`
- `src/app/api/unsubscribe/[token]/route.ts`
- `docker-compose.production.yml` / `staging.yml`
- `docs/runbooks/SECRET-ROTATION.md`
