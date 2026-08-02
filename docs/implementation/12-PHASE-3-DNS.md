# Phase 3 — Assistant DNS (SPF / DKIM / DMARC / MX / Reverse DNS)

Objectif : vérifier automatiquement la configuration DNS du domaine d'envoi et
afficher un statut **OK / WARNING / ERROR** avec explication pour chaque contrôle.

Aucune fonctionnalité d'envoi n'est modifiée. Les gates `DRY_RUN`,
`PRODUCTION_SENDING_ENABLED` et le connecteur SMTP (Phase 2) restent inchangés.

---

## 1. Pourquoi

Sans SPF / DKIM / DMARC, même un connecteur SMTP sain (Phase 2) produit des
emails classés spam ou rejetés. La checklist pilote (`04-PILOT-CHECKLIST.md`)
exige déjà ces enregistrements ; cette phase les rend **vérifiables en un clic**
depuis l'UI ops, sans outil externe.

---

## 2. Architecture

| Fichier | Rôle |
|---|---|
| `src/lib/dns/types.ts` | Contrats du rapport |
| `src/lib/dns/resolver.ts` | Abstraction DNS injectable + timeouts |
| `src/lib/dns/checks.ts` | Évaluateurs purs SPF/DKIM/DMARC/MX/rDNS |
| `src/lib/dns/dns-health.ts` | Orchestrateur + cache Redis/mémoire |
| `GET\|POST /api/ops/dns-health` | API RBAC |
| `/ops/dns` | Page « Santé DNS » |

**Décision** : `node:dns/promises` uniquement — zéro dépendance tierce. Le
résolveur est injectable pour les tests (aucun réseau en CI).

**Domaine cible** : domaine de `SMTP_FROM_EMAIL` par défaut. Surcharge optionnelle
`?domain=` / body `{ "domain" }` (FQDN validé — pas d'URL, pas d'IP, pas de
localhost).

**Reverse DNS** : résolu sur l'hôte SMTP du connecteur (preset inclus), pas sur
le domaine From — c'est l'IP d'émission qui doit avoir un PTR.

---

## 3. Règles de statut

### SPF

| Situation | Statut |
|---|---|
| Absent | ERROR |
| Plusieurs TXT `v=spf1` | ERROR |
| `+all` / `all` | ERROR |
| `~all` / `?all` / sans `all` | WARNING |
| `-all` + mécanisme d'auth | OK |

### DKIM

Sélecteurs : `DKIM_SELECTORS` (CSV) ou presets selon `MAIL_PROVIDER`
(`brevo` → `mail,brevo`, `sendgrid` → `s1,s2`, etc.).

| Situation | Statut |
|---|---|
| Aucune clé pour les sélecteurs | ERROR |
| `p=` vide (révocation) | ERROR |
| Clé `v=DKIM1` + `p=` non vide | OK |

### DMARC (`_dmarc.`)

| Situation | Statut |
|---|---|
| Absent | ERROR |
| `p=none` | WARNING |
| `p=quarantine` / `p=reject` sans `rua` | WARNING |
| `p=quarantine` / `p=reject` avec `rua` | OK |

### MX

| Situation | Statut |
|---|---|
| Absent | ERROR |
| Pointe vers `localhost` / `.invalid` | ERROR |
| Null MX (RFC 7505) | WARNING |
| Au moins un MX valide | OK |

### Reverse DNS

| Situation | Statut |
|---|---|
| IP du relais sans PTR | ERROR |
| PTR partiel (multi-IP) | WARNING |
| PTR sur toutes les IP | OK |

**Agrégat global** : ERROR > WARNING > OK.

---

## 4. API & UI

| Méthode | Permission | Comportement |
|---|---|---|
| `GET /api/ops/dns-health` | `ops:read` | Cache frais sinon test |
| `POST /api/ops/dns-health` | `settings:write` | Test forcé, 10/min, audit |

Page `/ops/dns` : badge global, carte par contrôle (statut + résumé + détails +
enregistrements bruts), bouton « Vérifier maintenant », champ domaine optionnel.

L'hôte SMTP reste **masqué** (`sm***.brevo.com`), cohérent avec Phase 2.

---

## 5. Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `DKIM_SELECTORS` | vide (presets) | CSV de sélecteurs DKIM |
| `DNS_HEALTH_CACHE_TTL_MS` | `300000` | Fraîcheur du cache |
| `DNS_PROBE_TIMEOUT_MS` | `5000` | Timeout par lookup |

---

## 6. Impact / risques / rollback

- **Impact** : lecture DNS sortante uniquement. Aucun envoi email, aucune
  migration Prisma, aucun changement worker.
- **Risque** : faux négatif DKIM si le sélecteur ESP n'est pas dans la liste →
  renseigner `DKIM_SELECTORS`. Faux positif rDNS sur IP partagée ESP est rare
  (les ESP publient un PTR).
- **Rollback** : retirer l'entrée de menu `/ops/dns` ; ou ignorer la page. Aucun
  flag feature obligatoire — la page est purement informative.

---

## 7. Tests

`tests/unit/dns-health-phase3.test.ts` — évaluateurs purs + orchestration avec
résolveur factice. Suite complète : 200 tests passés, 3 ignorés.

Vérification réseau réelle (`google.com` / `smtp.gmail.com`) : SPF `~all` →
WARNING, DMARC `p=reject` → OK, MX → OK, PTR → OK. DKIM ERROR attendu si les
sélecteurs ESP ne sont pas connus — d'où `DKIM_SELECTORS`.

---

## 8. Checklist ops

1. Ouvrir `/ops/dns` après configuration `SMTP_FROM_EMAIL`
2. Si DKIM ERROR : copier le sélecteur ESP dans `DKIM_SELECTORS`
3. Viser OK sur SPF (`-all`) + DKIM + DMARC (`quarantine`/`reject` + `rua`) + MX + PTR
4. Seulement ensuite basculer `DRY_RUN=false` (voir Phase 2)
