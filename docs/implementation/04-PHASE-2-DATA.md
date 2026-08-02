# Phase 2 — Intégrité PostgreSQL / Prisma

Date : 2026-07-27  
Statut : **TERMINÉE**  
Migration : `prisma/migrations/20260727010000_phase2_data_integrity`

## Objectif

Fiabiliser le modèle de données CDC : unicité email, normalisation, idempotence, versioning, snapshot d’approbation, tâches commerciales, index workers — **sans fusion/suppression automatique de contacts**.

## Fichiers principaux

| Fichier | Rôle |
|---------|------|
| `prisma/schema.prisma` | Modèles étendus |
| `prisma/migrations/20260727010000_phase2_data_integrity/migration.sql` | Migration SQL |
| `src/lib/data/integrity.ts` | Normalisation, idempotency key, hash snapshot |
| `scripts/detect-email-duplicates.ts` | Détection non destructive |
| `src/modules/sales-tasks/services/sales-task.service.ts` | SalesTask |
| `docs/implementation/04-DUPLICATE-MIGRATION-PLAN.md` | Plan doublons |

## Règles livrées

### 1. Email contact

- Colonne `email_normalized` (trim + lowercase).
- Index unique **partiel** : actifs (`deleted_at IS NULL`) et `is_duplicate = false`.
- Doublons existants : marqués `is_duplicate` + `duplicate_of_id` + éventuellement `TO_REVIEW` — **pas de delete**.
- Table `email_duplicate_resolutions` pour traçabilité.

### 2. Idempotence

- Clé déterministe : `{campaignId}:{contactId}:{sequenceStep}:v{sequenceVersion}`.
- `CampaignRecipient` unique sur `(campaignId, contactId, sequenceStep, sequenceVersion)`.
- `SendAttempt.idempotencyKey` unique (inchangé, désormais stable).

### 3. Versioning

- `Template.version` + `contentHash` (incrément contenu).
- `Sequence.version` (incrément si steps modifiés).
- `Segment.version` (incrément si filters modifiés).

### 4. Snapshot d’approbation

- `Campaign.approvalSnapshot` JSON immuable à la validation.
- `approvedContentHash` — l’envoi prod échoue si le hash courant diverge.
- Édition DRAFT/TESTED après validation claire le snapshot et remet en BROUILLON.

### 5. SalesTask

Champs : contact, campagne, event, type, statut, priorité, owner, titre, résumé minimisé, dates.

### 6. Index

Contacts `(status, deleted_at)`, `city`, `email_normalized` ; recipients `(campaign_id, is_stopped, is_sent)` ; events `(type, occurred_at)` ; etc.

## Opérations SQL à surveiller

| Opération | Nature | Commentaire |
|-----------|--------|-------------|
| `UPDATE contacts … is_duplicate` | Non destructive | Marquage seulement |
| `DELETE FROM suppression_list a USING …` | **Consolidation** | Supprime lignes **doublons exacts** de suppression (même email normalisé), garde la plus ancienne — documenté dans le plan doublons |
| Aucun `DROP TABLE` / `TRUNCATE` contacts | — | OK |

## Seed

- Plus de mot de passe hardcodé `Admin@123!`.
- `ADMIN_SEED_PASSWORD` (≥12) ou génération aléatoire → `.credentials.local`.

## Validation

| Check | Résultat |
|-------|----------|
| `prisma migrate deploy` | PASS (locale) |
| `prisma validate` / `generate` | PASS |
| `npm test` (36) dont DB Phase 2 | PASS |
| `tsc` / `lint` / `build` | PASS |

Activer les tests DB : `PHASE2_DB_TESTS=1` (dotenv charge `DATABASE_URL`).

## Limites restantes

- Pas d’UI de fusion manuelle des doublons.
- Pas d’API REST SalesTask (service prêt).
- Scheduler `SCHEDULED` / séquences multi-étapes / webhooks : hors Phase 2.
- Consolidation suppression list : revue manuelle recommandée avant prod si historique sensible.

## Déploiement recommandé

1. Backup Postgres.
2. `npx prisma migrate deploy`
3. `npm run db:detect-duplicates` (rapport + marquage)
4. Revue humaine des groupes `email_duplicate_resolutions`
5. `npm run db:seed` si environnement neuf (avec `ADMIN_SEED_PASSWORD`)
6. Rollback : restauration backup (pas de down migration destructive fournie)
