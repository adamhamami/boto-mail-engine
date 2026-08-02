# Checklist pilote contrôlé

**Décision associée : GO CONDITIONNEL — READY FOR CONTROLLED PILOT**  
Ne pas activer la production SMTP tant que les cases « bloquantes » ne sont pas cochées.

---

## A. Prérequis techniques (staging / Mailpit)

- [x] Code phases 1–7 fusionné localement
- [x] Recette R-01…R-10 PASS (`npm run test:recette` ou preuves 09)
- [x] `npm test` / `tsc` / `lint` / `build` OK
- [ ] Postgres + Redis dédiés staging (pas prod data)
- [ ] `prisma migrate deploy` + `db:seed` + `admin:password`
- [ ] Worker démarré (`npm run worker`)
- [ ] `GET /api/health` et `/ops` sains
- [ ] `DRY_RUN=true` **toujours** pour le premier pilote technique
- [ ] Mailpit (ou équivalent) — **pas** SMTP réel

---

## B. Sécurité & secrets (bloquant avant SMTP réel)

- [ ] `AUTH_SECRET` ≥32 chars unique (pas de placeholder)
- [ ] `WEBHOOK_SECRET` fort configuré
- [ ] Comptes ADMIN / CAMPAIGN_MANAGER / SALES / AUDITOR séparés
- [ ] Mot de passe admin changé
- [ ] Aucun secret dans git / screenshots
- [x] SoD : validateur ≠ créateur de campagne (`assertApproverIsNotCreator`)
- [x] Masquer SMTP host/user/password dans settings publics
- [x] Rate-limit login (`consumeRateLimit("login", email)`)
- [ ] Revue `npm audit` acceptée par responsable sécu

---

## C. Conformité & métier (hors code — bloquant juridique)

- [ ] Validation CNDP / Loi 09-08 (base légale, information, durée)
- [ ] Mentions légales / lien désinscription dans templates
- [ ] Liste suppression à jour
- [ ] Périmètre contacts pilote documenté (écoles ciblées)

---

## D. DNS & messagerie (avant envoi réel uniquement)

- [ ] Domaine d’envoi choisi
- [ ] SPF publié
- [ ] DKIM signé
- [ ] DMARC (au moins `p=none` puis durcir)
- [ ] Boîte de rebond / plaintes monitorée
- [ ] Connecteur SMTP testé avec `verifyConnection` **en staging**
- [ ] `PRODUCTION_SENDING_ENABLED=false` jusqu’à go écrit

---

## E. Déroulement pilote technique (DRY_RUN / Mailpit)

1. [ ] Import CSV échantillon (< 50 lignes)
2. [ ] Segment + preview éligibles/exclus
3. [ ] Template + séquence ≤3 mails
4. [ ] Assistant campagne → test allowlist
5. [ ] Vérifier logs DRY_RUN / Fake ou Mailpit
6. [ ] Simuler webhook reply signé → stop + SalesTask
7. [ ] Vérifier `/ops` (files, DLQ=0)
8. [ ] Export CSV sans formules dangereuses
9. [ ] Pause / resume campagne test
10. [ ] Compte-rendu signé (campagne, admin, auditeur)

---

## F. Passage envoi réel (après validation écrite — hors scope actuel)

- [ ] Recette rejouée
- [ ] `DRY_RUN=false` + `PRODUCTION_SENDING_ENABLED=true`
- [ ] Quotas bas (ex. 20/h, 100/j)
- [ ] Créneaux Casablanca
- [ ] Volume plafonné + allowlist élargie progressivement
- [ ] Plan rollback : pause globale, `PRODUCTION_SENDING_ENABLED=false`, restore DB si besoin
- [ ] Astreinte monitoring DLQ / rebonds

---

## G. Rollback migrations

Prisma ne fournit pas de down auto pour ces migrations.

Procédure :

1. Snapshot Postgres avant `migrate deploy`
2. En incident : restore snapshot
3. Documenter version migration (`prisma migrate status`)

---

## Signature pilote

| Rôle | Nom | Date | Visa |
|---|---|---|---|
| Responsable campagne | | | |
| Administrateur | | | |
| Auditeur / conformité | | | |
| Technique | | | |
