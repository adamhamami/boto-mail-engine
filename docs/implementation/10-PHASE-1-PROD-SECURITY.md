# Phase 1 — Sécurité Production

**Objectif :** passer de `READY FOR CONTROLLED PILOT` → fondations `READY FOR PRODUCTION` (sécurité web / secrets / headers), **sans** activer SMTP réel ni casser les automatisations métier.

**Date :** 2026-08-01  
**Règles :** ne pas casser routes API, Prisma, BullMQ, RBAC, campagnes, webhooks, tests existants.

---

## Décisions (pourquoi / impact / risques / rollback)

### 1. Validation env production renforcée + boot fail-fast

| | |
|---|---|
| **Pourquoi** | `getEnv()` était lazy ; l’edge Auth.js lisait `process.env.AUTH_SECRET` hors Zod. Un mauvais `.env` pouvait démarrer partiellement. |
| **Impact** | `instrumentation.ts` + script `env:validate` ; prod exige HTTPS `APP_URL`/`AUTH_URL`, `WEBHOOK_SECRET`, secrets non faibles ; `AUTH_SECRET_PREVIOUS` pour rotation. |
| **Risques** | Boot refuse de démarrer si env prod invalide (souhaité). Dev/test inchangés. |
| **Rollback** | Retirer `instrumentation.ts` ; assouplir `superRefine` dans `env.ts`. |

### 2. Cookies Auth.js explicites (HttpOnly / Secure / SameSite)

| | |
|---|---|
| **Pourquoi** | Cookies implicites Auth.js ; pas de politique documentée pour reverse-proxy HTTPS. |
| **Impact** | `useSecureCookies` + options cookies en production ; `trustHost: true` ; session maxAge inchangé (30 j). Rotation JWT via `AUTH_SECRET` + `AUTH_SECRET_PREVIOUS`. |
| **Risques** | Sessions existantes invalidées au premier déploiement prod (cookie name/secure) — acceptable. |
| **Rollback** | Retirer bloc `cookies` / `useSecureCookies` de `auth.config.ts`. |

### 3. Headers CSP + HSTS + application sur toutes les réponses middleware

| | |
|---|---|
| **Pourquoi** | Helmet dans `package.json` non branché ; pas de CSP ; headers absents sur 401/redirect. |
| **Impact** | Module `security-headers.ts` ; CSP stricte adaptée Next (inline scripts limités) ; headers aussi dans `next.config`. |
| **Risques** | CSP trop stricte peut casser UI (scripts Next). CSP en `Content-Security-Policy-Report-Only` d’abord ? → on part sur CSP enforce avec allowlist Next standard ; ajustable via env `CSP_REPORT_ONLY=true`. |
| **Rollback** | `CSP_ENABLED=false` ou retirer header CSP. |

### 4. CSRF fail-closed (Origin / Sec-Fetch-Site)

| | |
|---|---|
| **Pourquoi** | Origin manquant = bypass CSRF sur API authentifiées mutantes. |
| **Impact** | Exige Origin matching Host **ou** `Sec-Fetch-Site` ∈ same-origin/same-site/none. Public paths (`/api/auth`, webhooks…) exempts. |
| **Risques** | Clients API sans Origin (scripts curl) refusés sur routes protégées — attendu ; utiliser session navigateur ou outils avec Origin. |
| **Rollback** | Assouplir condition dans `middleware.ts`. |

### 5. Rate-limit login dédié (anti brute-force)

| | |
|---|---|
| **Pourquoi** | Login partageait 100 req/min — inefficace contre brute-force. |
| **Impact** | `LOGIN_RATE_LIMIT_MAX` (défaut 5) / `LOGIN_RATE_LIMIT_WINDOW_MS` (900s) ; clé `login` + clé `login-ip` si IP fournie. Mémoire (comme avant) — Redis rate-limit = Phase ultérieure. |
| **Risques** | Utilisateurs légitimes bloqués 15 min après 5 échecs — acceptable. Tests unitaires mis à jour. |
| **Rollback** | Remettre login sur `RATE_LIMIT_*` générique. |

### 6. Safe-log / Pino redact + SMTP errors sans secrets

| | |
|---|---|
| **Pourquoi** | `safe-log` non branché ; erreurs SMTP pouvaient logger `err` brut. |
| **Impact** | Redact paths Pino ; `safe-log` récursif ; SMTP logge `message` seulement. |
| **Risques** | Moins de détail debug SMTP — volontaire. |
| **Rollback** | Retirer `redact` du logger. |

### 7. Upload : magic bytes + MIME resserré

| | |
|---|---|
| **Pourquoi** | Confiance extension + MIME client uniquement. |
| **Impact** | Vérif signatures CSV/XLSX (ZIP PK) sur buffer ; rejet `octet-stream` sans signature. |
| **Risques** | Fichiers exotiques refusés — OK pour V1. |
| **Rollback** | Désactiver check magic via flag ou retirer fonction. |

### 8. Chiffrement secrets applicatifs (utilitaire)

| | |
|---|---|
| **Pourquoi** | CDC : secrets chiffrés au repos. SMTP reste env (pas en DB). Prépare `AppSetting.isSecret`. |
| **Impact** | `secrets-crypto.ts` AES-256-GCM dérivé de `AUTH_SECRET` — **opt-in**, aucune migration forcée. |
| **Risques** | Rotation `AUTH_SECRET` sans `AUTH_SECRET_PREVIOUS` rend indéchiffrables les valeurs chiffrées avec l’ancien secret. |
| **Rollback** | Ne pas utiliser l’utilitaire ; supprimer le module. |

### 9. Probes de santé bornées (SRE)

| | |
|---|---|
| **Pourquoi** | `/api/health` pendait **>60 s** quand Redis était injoignable (`maxRetriesPerRequest: null` requis par BullMQ) → un load balancer aurait timeout au lieu de recevoir 503. |
| **Impact** | `health-timeout.ts` : `/api/health` borné à 2 s/probe, `ops-health` à 3 s. La connexion BullMQ des workers reste inchangée. |
| **Risques** | Sous forte latence (>2 s) une dépendance saine pourrait être signalée down — seuil ajustable. |
| **Rollback** | Retirer `checkWithTimeout` / `withHealthTimeout` des deux fichiers. |

### 10. Génération secrets + `.env.production.example`

| | |
|---|---|
| **Pourquoi** | `WEBHOOK_SECRET` manquant dans le générateur / template prod incomplet. |
| **Impact** | Script + template enrichis ; doc rotation. |
| **Risques** | Aucun runtime. |
| **Rollback** | N/A docs. |

---

## Hors scope Phase 1 (volontaire)

- Activation SMTP réel / `DRY_RUN=false`
- Rate-limit Redis multi-instance (Phase SRE)
- KMS cloud / Vault
- IMAP réel
- Changement logique campagnes / Prisma schema métier

---

## Checklist validation

- [x] `npx vitest run` PASS (142+ ; Phase 1: 14 nouveaux)
- [x] `npx tsc --noEmit` PASS
- [x] lint Phase 1 PASS
- [x] `npm run build` PASS
- [x] `npm run env:validate` PASS
- [~] E2E : 17/18 PASS ; 1 timeout `/api/health` car Docker Desktop (Postgres/Redis) arrêté sur la machine — hors régression code
- [x] DRY_RUN toujours true par défaut
- [x] CSP prod sans `unsafe-eval` ; CSP dev avec `unsafe-eval` (React Refresh)
