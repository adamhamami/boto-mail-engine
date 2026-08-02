# Phase 9 — Sécurité dépendances

Objectif : `npm audit` à 0 vulnérabilité, packages vulnérables/obsolètes corrigés
**sans casser** le projet (pas de majors risqués : BullMQ 6, ioredis 6, ESLint 10, TS 7).

---

## 1. Résultat

| Avant | Après |
|---|---|
| 16 vulns (5 moderate, 11 high) | **0 vulnérabilités** |

```bash
npm audit          # found 0 vulnerabilities
npm run audit:ci   # --omit=dev --audit-level=high
```

---

## 2. Correctifs directs

| Package | Avant → Après | Pourquoi |
|---|---|---|
| `nodemailer` | 8.0.11 → **9.0.3** | GHSA-p6gq (raw bypass) |
| `prisma` / `@prisma/client` / `adapter-pg` | 7.9.0 → **7.9.1** | find-my-way / valibot via `@prisma/dev` |
| `react` / `react-dom` | 19.2.4 → **19.2.8** | patch |
| `bullmq` | 5.81.2 → **5.81.3** | patch (pas v6) |
| `lucide-react`, `react-hook-form`, `shadcn`, Playwright, `@types/*` | patch/minor | obsolescence safe |

Défense en profondeur SMTP (`disableFileAccess` / `disableUrlAccess`) dans
`src/lib/mail/smtp-provider.ts`.

---

## 3. Overrides npm (transitives)

```json
"overrides": {
  "nodemailer": "^9.0.3",
  "uuid": "^11.1.1",
  "postcss": "^8.5.25",
  "sharp": "^0.35.3",
  "brace-expansion": "^2.1.4",
  "@hono/node-server": "^2.0.12",
  "find-my-way": "^9.7.0",
  "valibot": "^1.4.2"
}
```

| Override | Advisory / raison |
|---|---|
| `nodemailer` | Force aussi `@auth/core` / `next-auth` |
| `uuid` | exceljs → GHSA-w5hq |
| `postcss` | next nested → XSS / source map |
| `sharp` | next → libvips CVEs |
| `brace-expansion` | DoS expansion |
| `@hono/node-server` | MCP SDK path traversal |
| `find-my-way` / `valibot` | prisma CLI / `@prisma/dev` |

---

## 4. Non touché (volontairement)

| Package | Raison |
|---|---|
| `next` 16.2.12 | Déjà latest 16.x stable ; vulns via overrides |
| `bullmq` 6 / `ioredis` 6 | Majors cassants |
| `eslint` 10 / `typescript` 7 | Majors outillage |
| `next-auth` v4 | Régression (projet en Auth.js v5 beta) |
| `@vitejs/plugin-react` 6.0.5 | Conflit peer `@babel/core@8` |
| `@types/node` 26 | Hors Node 20 runtime |

---

## 5. CI

`.github/workflows/ci.yml` — job `audit` :

1. Artifact JSON
2. Fail si **high+** (prod)
3. Fail si **moderate+** (arbre complet)

---

## 6. Rollback

```bash
git checkout HEAD~1 -- package.json package-lock.json
npm ci
```

Retirer les `overrides` si un outil refuse la résolution (peu probable).

---

## 7. Maintenance

```bash
npm run audit:full
npm run deps:outdated
npm audit fix          # sans --force
```
