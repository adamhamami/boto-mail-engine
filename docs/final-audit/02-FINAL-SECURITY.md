# Audit sécurité final (OWASP-oriented)

Date : 2026-07-27  
Méthode : revue code + tests exécutés + `npm audit --omit=dev`  
SMTP réel : **non activé**

---

## Synthèse

| Domaine | Avant | Après |
|---|---|---|
| Auth / sessions | Auth.js + RBAC API | Inchangé + nav RBAC filtrée |
| Secrets | AUTH_SECRET défaut dangereux | Défaut interdit en prod ; SMTP host/user/password `***` |
| Webhooks | Public non signé | HMAC + timestamp + rate-limit |
| Injection | XSS template, CSV formula | Escape HTML ; neutralize CSV |
| Envoi | DRY_RUN bypass test | Gates centraux + revalidation worker |
| Dépendances | 15 vulns (xlsx high) | ~24 vulns (exceljs/nodemailer/next) — **xlsx retiré** |

**Verdict sécurité applicative métier : READY FOR CONTROLLED PILOT** (SoD / masquage SMTP / rate-limit login fermés)  
**Verdict dépendances npm : FAIL audit** (risque résiduel documenté) → **GO CONDITIONNEL** global

---

## OWASP Top 10 (mapping)

| # | Risque | État | Preuve / écart |
|---|---|---|---|
| A01 Broken Access Control | MITIGÉ | `requirePermission` API ; menus filtrés ; SoD `assertApproverIsNotCreator` |
| A02 Cryptographic Failures | MITIGÉ | AUTH_SECRET fort requis prod ; secrets pas en repo |
| A03 Injection | MITIGÉ | Zod ; escape HTML templates ; CSV `'` prefix ; Prisma |
| A04 Insecure Design | MITIGÉ | Gates DRY_RUN / éligibilité / snapshot |
| A05 Security Misconfiguration | MITIGÉ | SMTP public masqué ; headers middleware HSTS en prod |
| A06 Vulnerable Components | **OUVERT** | `npm audit` ~24 (nodemailer, next/postcss, exceljs chain) |
| A07 Auth Failures | MITIGÉ | Credentials Auth.js ; `consumeRateLimit("login", email)` |
| A08 Data Integrity Failures | MITIGÉ | Snapshot hash ; idempotency keys ; webhook signature |
| A09 Logging Failures | MITIGÉ | Pino + correlationId ; safe-log filtre secrets |
| A10 SSRF | MITIGÉ sous DRY_RUN | SMTP réel non branché ; FakeMail en tests |

---

## Contrôles critiques CDC

| Contrôle | Statut |
|---|---|
| Pas d’envoi si DRY_RUN | PASS (tests) |
| Allowlist mode test | PASS |
| Webhook non signé → 401 | PASS |
| Unsub / réponse stoppe séquence | PASS |
| Export sans password/token | PASS |
| IDOR write auditor | PASS (permissions) |
| Rate-limit webhook | PASS |
| Rate-limit login | PASS |
| SoD créateur ≠ approbateur | PASS |
| SMTP host/user/password masqués | PASS |

---

## Dépendances

```text
npm audit --omit=dev → ~24 vulnerabilities (5 moderate, 19 high)
```

Principales chaînes : `exceljs`→`archiver`/`uuid`, `nodemailer` (via next-auth), `next`→`postcss`/`sharp`, `prisma`→`find-my-way`/`valibot`.

**Action pilote :** accepter sous surveillance ; planifier upgrades non-breaking ; ne pas `npm audit fix --force` (breaking Next/Prisma) — un essai a cassé `node_modules` (vitest/eslint) puis a été rétabli via `npm install`.

---

## Migrations & rollback

| Point | État |
|---|---|
| Migrations forward Phase 2–5 | Présentes sous `prisma/migrations/` |
| Unique email actifs | `contacts_email_normalized_active_unique` WHERE deleted |
| Rollback automatique Prisma | **Absent** — procédure = restore snapshot DB |
| Seed permissions | `npm run db:seed` (rejouer après nouveaux slugs) |

---

## Recommandations avant SMTP réel

1. ~~Forcer `validatedById !== createdById` (SoD).~~ **FAIT**
2. ~~Masquer SMTP host/user.~~ **FAIT**
3. ~~Rate-limit login.~~ **FAIT**
4. Revue dépendances / pin versions (sans `--force`).
5. Backup + restore drill avant `migrate deploy` prod.
6. Ne pas désactiver DRY_RUN sans checklist pilote signée.
