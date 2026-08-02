# Phase 2 — Connecteur SMTP réel + page Santé SMTP

Objectif : disposer d'un connecteur d'envoi réel pour Brevo, Mailgun, Postmark,
Amazon SES et le SMTP classique, avec un diagnostic automatique (TLS, STARTTLS,
authentification, quota, santé) exposé sur une page dédiée.

**Aucune fonctionnalité existante n'est modifiée** : les gates `DRY_RUN`,
`PRODUCTION_SENDING_ENABLED`, `ALLOW_TEST_SMTP`, les allowlists, les quotas
Redis, le worker et les recettes R-01→R-10 sont inchangés.

---

## 1. Décision d'architecture : relais SMTP plutôt que SDK par fournisseur

Brevo, Mailgun, Postmark, Amazon SES et SendGrid exposent tous un relais SMTP
authentifié. Deux options étaient possibles :

| Option | Conséquences |
|---|---|
| Un SDK HTTP par fournisseur | 4 nouvelles dépendances, 4 chemins d'envoi, 4 formats d'erreur, recettes R-01→R-10 à rejouer par fournisseur |
| **Un transport SMTP + presets** *(retenu)* | 0 dépendance, 1 seul chemin d'envoi déjà validé, presets purement déclaratifs |

Le preset ne porte que des valeurs **publiques** : hôte, port, chiffrement,
documentation. Les identifiants restent exclusivement dans `SMTP_USER` /
`SMTP_PASSWORD`, jamais en base.

### Presets (`src/lib/mail/providers.ts`)

| `MAIL_PROVIDER` | Hôte | Port | Chiffrement | `SMTP_USER` | `SMTP_PASSWORD` |
|---|---|---|---|---|---|
| `smtp` | `SMTP_HOST` | `SMTP_PORT` | selon `SMTP_SECURE` | identifiant serveur | mot de passe serveur |
| `brevo` | `smtp-relay.brevo.com` | 587 | STARTTLS | login Brevo | clé SMTP |
| `mailgun` | `smtp.mailgun.org` | 587 | STARTTLS | `postmaster@domaine` | mot de passe SMTP |
| `postmark` | `smtp.postmarkapp.com` | 587 | STARTTLS | Server API Token | Server API Token |
| `ses` | `email-smtp.<SES_REGION>.amazonaws.com` | 587 | STARTTLS | SMTP username SES | SMTP password SES |
| `sendgrid` | `smtp.sendgrid.net` | 587 | STARTTLS | `apikey` | clé API |

**Précédence** : une variable d'environnement explicitement définie surcharge le
preset. Exemple région Mailgun EU : `MAIL_PROVIDER=mailgun` +
`SMTP_HOST=smtp.eu.mailgun.org`.

---

## 2. Modifications et justifications

### 2.1 `src/lib/mail/providers.ts` (nouveau)

- **Pourquoi** : centraliser la résolution du connecteur, le masquage d'hôte et
  l'expurgation des messages d'erreur.
- **Impact** : `getMailProviderConfig()` conserve sa signature et délègue ici,
  donc tous les appelants existants sont inchangés.
- **Sécurité** : l'allowlist SSRF `SMTP_HOST_ALLOWLIST` s'applique désormais à
  l'hôte **résolu**, preset compris. Un preset ne peut donc pas contourner le
  garde-fou d'egress.
- **Risque** : en production avec allowlist active, passer à `MAIL_PROVIDER=brevo`
  sans ajouter `smtp-relay.brevo.com` à l'allowlist lève une erreur explicite au
  démarrage du connecteur. C'est le comportement voulu (fail-closed).
- **Rollback** : `MAIL_PROVIDER=smtp` + `SMTP_HOST` explicite reproduit
  exactement le comportement d'avant Phase 2.

### 2.2 `src/lib/mail/smtp-provider.ts`

- **Ajout** : `name` dynamique (valeur de `MAIL_PROVIDER`), timeouts de
  connexion/bannière/socket, `requireTLS`, `tls.minVersion=TLSv1.2`, EHLO annoncé
  avec le domaine expéditeur, et `checkAuthentication()` pour le diagnostic.
- **Pourquoi les timeouts** : sans eux, un relais injoignable bloque un worker
  jusqu'au timeout TCP par défaut du système.
- **Pourquoi l'EHLO par domaine** : évite de divulguer le hostname du conteneur
  au fournisseur.
- **Impact sur les données** : `SendAttempt.provider` enregistre désormais
  `brevo`, `postmark`… au lieu de `smtp` systématiquement. Les valeurs
  historiques restent valides ; aucune migration n'est nécessaire.
- **Suppression** : `FutureAPIProvider` (échouait volontairement pour
  sendgrid/mailgun/ses) n'a plus d'objet — ces connecteurs fonctionnent
  réellement. Il n'était importé que par `src/lib/mail/index.ts`.

### 2.3 `SMTP_REQUIRE_TLS` (nouveau)

- **Pourquoi** : interdire un envoi en clair si STARTTLS est indisponible.
- **Défaut** : `true` en production, `false` ailleurs.
- **Pourquoi ce défaut** : Mailpit (`npm run docker:tools`) n'expose pas TLS ;
  un défaut `true` global aurait cassé la boucle de développement local.
- **Forçage** : toujours `true` pour les relais publics, quelle que soit la
  variable — un relais Internet ne doit jamais recevoir de credentials en clair.
- **Risque** : un relais interne legacy sans STARTTLS refuserait d'envoyer en
  production. **Rollback** : `SMTP_REQUIRE_TLS=false` (à documenter comme
  dérogation) ou corriger le relais.

### 2.4 `src/lib/mail/smtp-diagnostics.ts` (nouveau)

Sonde SMTP bas niveau : TCP → bannière → EHLO → STARTTLS → certificat → QUIT.

- **Ne transmet aucun identifiant** et **n'envoie aucun message** : la sonde
  s'arrête avant `MAIL FROM`. Un test le vérifie face à un serveur SMTP factice
  qui enregistre toutes les commandes reçues.
- **`rejectUnauthorized: false` sur la sonde uniquement** : permet d'afficher
  « certificat expiré / chaîne invalide » au lieu d'un échec opaque. Le
  transport d'envoi (nodemailer) conserve la validation stricte.
- **Ne lève jamais** : les échecs sont décrits dans `errors[]` pour que la page
  reste affichable.

### 2.5 `src/lib/mail/provider-quota.ts` (nouveau)

| Fournisseur | Quota interrogeable | Mécanisme |
|---|---|---|
| Brevo | Oui | `GET /v3/account`, en-tête `api-key` |
| Amazon SES | Oui | `GET /v2/email/account` signé AWS SigV4 (`node:crypto`, pas de SDK) |
| Mailgun, Postmark, SendGrid, SMTP | Non | Pas d'endpoint de quota — les quotas locaux font foi |

- **Optionnel** : sans clé, le statut est `not_configured` — jamais une erreur.
- **SSRF** : les URLs sont des constantes ; aucune valeur utilisateur n'entre
  dans la construction de la requête.
- **Identifiants** : clés en **lecture seule**, distinctes des credentials
  d'envoi. `BREVO_API_KEY`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` sont
  ajoutées aux listes de rédaction du logger.

### 2.6 `src/lib/mail/smtp-health.ts` (nouveau)

Agrège sonde + authentification + quotas locaux (Redis) + quota fournisseur.

- **Cache** : Redis (`smtp:health:last`, TTL 7 j) + mémoire process. Un rapport
  frais (`SMTP_HEALTH_CACHE_TTL_MS`, défaut 5 min) est servi sans ouvrir de
  connexion — la page peut s'auto-rafraîchir sans marteler le relais.
- **Anti-concurrence** : les appels simultanés partagent une seule exécution.
- **Timeouts** : toutes les lectures Redis/quota passent par
  `withHealthTimeout` (Phase 1) — aucune probe ne peut pendre.
- **Statuts** :
  - `unhealthy` : injoignable ou authentification refusée
  - `degraded` : TLS absent, certificat non validé ou expirant sous 7 jours,
    quota local ≥ 90 %, erreur de lecture du quota fournisseur
    (7 jours et non 15 : les relais publics renouvellent tard leurs certificats
    Let's Encrypt, un seuil plus large alerterait en permanence)
  - `unknown` : `SMTP_HEALTH_PROBE_ENABLED=false`

### 2.7 API `GET|POST /api/ops/smtp-health` (nouveau)

| Méthode | Permission | Comportement |
|---|---|---|
| `GET` | `ops:read` | Rapport en cache s'il est frais, sinon test |
| `POST` | `settings:write` | Test forcé, 5/minute par utilisateur, journalisé en audit (`VALIDATE` / module `ops`) |

`runtime = "nodejs"` : la sonde ouvre des sockets et lit un certificat.

### 2.8 Page `/ops/smtp` (nouveau)

Affiche exactement les rubriques demandées : **connexion**, **délai** (par
étape), **certificat**, **quota** (local + fournisseur), **erreurs**, **dernier
test**, plus le rappel des garde-fous d'envoi. Rafraîchissement automatique
toutes les 60 s, bouton « Tester maintenant ».

Entrée de menu « Santé SMTP » sous `ops:read`. Le surlignage de `/ops` devient
exact pour ne pas activer deux entrées à la fois.

### 2.9 Ce qui n'est PAS exposé

- Hôte complet : masqué (`sm***.brevo.com`) comme dans `/settings`
- `SMTP_USER`, `SMTP_PASSWORD`, clés API : absents du payload
- Messages d'erreur serveur : identifiants retirés via `sanitizeSmtpMessage`
  (certains relais renvoient « 535 Authentication failed for user@domain »)

---

## 3. Interaction avec DRY_RUN

`DRY_RUN=true` interdit tout **envoi** fournisseur. La sonde de santé n'envoie
pas de message : elle réalise une poignée de main et une commande `AUTH`. Elle
reste donc active sous `DRY_RUN`, ce qui est précisément l'usage attendu —
valider le connecteur **avant** de basculer `DRY_RUN=false`.

Le payload porte l'invariant `probeSendsEmail: false`, et
`mustSimulateProviderSend()` est inchangé. Pour couper toute sortie réseau :
`SMTP_HEALTH_PROBE_ENABLED=false`.

---

## 4. Variables d'environnement ajoutées

| Variable | Défaut | Rôle |
|---|---|---|
| `MAIL_PROVIDER` | `smtp` | Ajout de `brevo`, `postmark` à l'énumération |
| `SES_REGION` | `eu-west-1` | Hôte du relais SES |
| `SMTP_REQUIRE_TLS` | `true` en prod | Refuse l'envoi en clair |
| `SMTP_HEALTH_PROBE_ENABLED` | `true` | Coupe la sonde réseau |
| `SMTP_HEALTH_CACHE_TTL_MS` | `300000` | Fraîcheur avant re-test automatique |
| `SMTP_PROBE_TIMEOUT_MS` | `8000` | Budget par étape de la sonde |
| `BREVO_API_KEY` | vide | Quota Brevo (lecture seule) |
| `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` | vide | Quota SES (`ses:GetAccount`) |

Aucune n'est obligatoire : toutes ont un défaut sûr.

---

## 5. Migration Prisma

**Aucune.** Le rapport est mis en cache dans Redis, pas en base — pas de
nouvelle table, pas de nouvelle valeur d'énumération.

---

## 6. Tests

`tests/unit/smtp-connector-phase2.test.ts` — 30 tests :

- résolution des presets, surcharge par variable explicite, région SES
- allowlist SSRF appliquée à l'hôte résolu
- `requireTls` forcé pour les relais publics
- masquage d'hôte (domaine et IPv4), expurgation des identifiants
- analyse EHLO (`STARTTLS`, `AUTH`, `AUTH=`, `SIZE`)
- sonde contre un serveur SMTP factice : latences, capacités, et **aucune
  commande `MAIL` / `RCPT` / `DATA` / `AUTH` émise**
- STARTTLS absent avec TLS exigé, connexion refusée, bannière `554`
- SigV4 : requête canonique, signature déterministe et dépendante du secret,
  secret jamais présent dans l'en-tête `Authorization`
- règles de statut (sain / dégradé / hors service)
- non-régression : `DRY_RUN` par défaut, `getMailProviderConfig()` aligné

Suite complète : 176 tests passés, 3 ignorés — aucune régression.
`tsc --noEmit`, `eslint` et `next build` passent (`/ops/smtp` et
`/api/ops/smtp-health` enregistrés).

### Vérification contre des relais réels

Sonde exécutée sans identifiants (poignée de main seule) :

| Relais | TLS | Certificat | AUTH annoncés | Latence totale |
|---|---|---|---|---|
| `smtp-relay.brevo.com:587` | TLSv1.3 / `TLS_AES_128_GCM_SHA256` | `smtp-relay-ovh.brevo.com`, Let's Encrypt | PLAIN, LOGIN, CRAM-MD5 | 474 ms |
| `smtp.postmarkapp.com:587` | TLSv1.2 / `ECDHE-RSA-AES128-GCM-SHA256` | `*.postmarkapp.com`, DigiCert | PLAIN, LOGIN, CRAM-MD5, DIGEST-MD5 | 591 ms |

STARTTLS négocié, chaîne de certificats validée (`authorized: true`), aucune
erreur, aucune commande d'envoi émise.

> Les tests Playwright n'ont pas été rejoués : Docker (Postgres/Redis) n'était
> pas démarré sur la machine. Aucun fichier E2E n'a été modifié.

---

## 7. Checklist de bascule vers un fournisseur réel

1. `MAIL_PROVIDER=<brevo|mailgun|postmark|ses|sendgrid>`
2. `SMTP_USER` / `SMTP_PASSWORD` selon le tableau des presets
3. `SMTP_FROM_EMAIL` sur un domaine authentifié SPF + DKIM + DMARC chez le
   fournisseur
4. Ajouter l'hôte résolu à `SMTP_HOST_ALLOWLIST`
5. `npm run env:validate` → vérifier le bloc `mailConnector`
6. Ouvrir `/ops/smtp` → « Tester maintenant » → statut **Opérationnel**,
   TLS négocié, certificat valide, authentification acceptée
7. Seulement ensuite : `DRY_RUN=false`, puis `ALLOW_TEST_SMTP=true` pour une
   campagne de test sur allowlist, puis `PRODUCTION_SENDING_ENABLED=true`

## 8. Rollback

| Portée | Action |
|---|---|
| Fournisseur | `MAIL_PROVIDER=smtp` + `SMTP_HOST` explicite |
| Exigence TLS | `SMTP_REQUIRE_TLS=false` |
| Sonde réseau | `SMTP_HEALTH_PROBE_ENABLED=false` (page en statut « Non testé ») |
| Quota fournisseur | Vider `BREVO_API_KEY` / `SES_*` |
| Envois | `DRY_RUN=true` — inchangé par la Phase 2 |
