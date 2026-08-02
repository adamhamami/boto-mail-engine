# Guide administrateur — BotoSchool Email Platform

Public : administrateurs plateforme (rôle **Administrateur** / permissions étendues).

Objectif : configurer utilisateurs, sécurité, SMTP/DNS, conformité — **sans** coder.

---

## 1. Première connexion

1. Obtenir l’URL (ex. `https://email.botoschool.com` ou local `:3000`).
2. Se connecter avec le compte admin seedé.
3. **Changer le mot de passe** immédiatement (`npm run admin:password` côté ops, ou via Users si exposé).
4. Vérifier `/settings` et `/ops` (santé).

Compte admin seed : voir `.credentials.local` (jamais committer).

---

## 2. Rôles & permissions

| Rôle | Usage typique |
|---|---|
| **Administrateur** | Tout : users, settings, ops, conformité |
| **Responsable campagne** | Imports, segments, templates, validation, envoi |
| **Commercial** | Réponses, qualification, lecture contacts |
| **Auditeur** | Audit, exports, lecture seule |

Création / désactivation utilisateurs : **Users** (`/users`).  
Principe : moindre privilège — un commercial n’a pas `campaigns:validate`.

---

## 3. Paramètres & envoi

### Gates CDC (lecture seule pour admin métier — bascule = ops)

| Variable | Sûr (défaut) | Envoi réel |
|---|---|---|
| `DRY_RUN` | `true` | `false` |
| `PRODUCTION_SENDING_ENABLED` | `false` | `true` |

**Ne pas** activer l’envoi réel sans checklist production signée ([production/00-CHECKLIST.md](../production/00-CHECKLIST.md)).

### Vérifications admin

| Page | Action |
|---|---|
| `/ops/smtp` | Diagnostic connecteur (TLS, auth) — hors DRY_RUN pour test forcé |
| `/ops/dns` | SPF / DKIM / DMARC / MX / rDNS |
| `/settings` | Préférences + aperçu SMTP |
| `/suppression` | Liste d’exclusion |

---

## 4. Cycle campagne (métier)

```
Import contacts → Qualifier → Segment → Template / Séquence
→ Campagne DRAFT → Tests → Soumettre → Valider → Programmer → Suivre
```

1. **Import** (`/imports`) : mapping colonnes, rapport rejets.
2. **Contacts** : corriger doublons, statut, tags.
3. **Segments** : définir l’audience.
4. **Templates** : variables `{{prenom}}` etc. — aperçu sécurisé.
5. **Séquences** : max **3** emails (délais CDC J0 / J+4–6 / J+10–14).
6. **Campagne** :
   - Soumettre → `PENDING_VALIDATION`
   - Valider (`campaigns:validate`) → `VALIDATED`
   - Programmer → `SCHEDULED` → worker démarre `RUNNING`
7. **Pause / reprise / annulation** depuis la fiche campagne.
8. **Réponses** + **tâches commerciales** pour le suivi.

Règle : **aucun envoi** sans validation explicite.

---

## 5. Conformité CNDP

Page `/compliance` :

- Demandes personnes concernées (accès, effacement…)
- Export sujet / anonymisation (permissions dédiées)
- Politique de conservation

Détail ops/légal : [production/10-CONFORMITE.md](../production/10-CONFORMITE.md).

---

## 6. Audit

`/audit` : journal des actions (qui / quoi / quand).  
Export CSV pour contrôles. Les métadonnées portent `correlationId` / `traceId` utiles aux incidents.

---

## 7. Bonnes pratiques

- Tester toujours en **DRY_RUN** / Mailpit avant bascule.
- Limiter les validateurs de campagne (séparation des pouvoirs).
- Surveiller bounce / failure dans `/ops/monitoring` et dashboard.
- Ne jamais coller de mots de passe SMTP dans un ticket — rotation : [SECRET-ROTATION.md](../runbooks/SECRET-ROTATION.md).

---

## 8. Voir aussi

- [OPERATOR.md](./OPERATOR.md) — incidents, health, Grafana
- [Architecture.md](../Architecture.md)
- [production/README.md](../production/README.md)
