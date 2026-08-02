# Plan de migration des doublons email

## Stratégie canonique de normalisation

```
normalize(email) = lower(trim(email)).replace(/\s+/g, "")
```

Stockée dans `contacts.email_normalized` et `suppression_list.email_normalized`.

`contacts.email` conserve la valeur saisie (affichage) ; la contrainte d’unicité porte sur la forme normalisée.

## Étapes (déjà dans la migration Phase 2)

1. **Ajouter** `email_normalized` (nullable puis backfill).
2. **Détecter** les groupes `PARTITION BY email_normalized`.
3. **Marquer** (sans delete) : plus ancien = canonique ; autres → `is_duplicate=true`, `duplicate_of_id`, `TO_REVIEW` si étaient `ELIGIBLE`.
4. **Index unique partiel** :
   ```sql
   CREATE UNIQUE INDEX contacts_email_normalized_active_unique
   ON contacts (email_normalized)
   WHERE deleted_at IS NULL AND is_duplicate = FALSE;
   ```
5. **Traçabilité** : table `email_duplicate_resolutions` + script `npm run db:detect-duplicates`.

## Rapport de conflits

- Script : `scripts/detect-email-duplicates.ts`
- Sortie JSON : `docs/implementation/04-duplicate-report.json` (généré à l’exécution)
- Lignes DB : `email_duplicate_resolutions` (`DETECTED` → `MARKED_DUPLICATE`)

## Fusion / mise à revoir (humaine)

| Action | Automatique ? | Description |
|--------|---------------|-------------|
| Marquer doublon | Oui (migration/script) | `is_duplicate` + lien canonique |
| Fusionner fiches | **Non** | Décision métier : conserver tags/source/consent |
| Supprimer contact | **Non** | Soft-delete seulement après validation |
| Dismiss | Manuel | Statut `DISMISSED` sur résolution |

Procédure proposée :

1. Exporter le rapport JSON.
2. Pour chaque groupe : choisir le canonique (déjà le plus ancien).
3. Copier manuellement les attributs utiles des doublons vers le canonique.
4. Soft-delete ou garder les doublons marquées `is_duplicate` (exclus des segments via `isDuplicate: false` dans les filtres).

## Suppression list

La migration consolide les **doubles entrées** (même email normalisé) en gardant la plus ancienne.  
Ce n’est **pas** une suppression de contacts. Si plusieurs motifs coexistent pour le même email, un seul motif survit — à auditer avant prod si nécessaire.

## Rollback

- Restaurer un backup Postgres antérieur à `20260727010000_phase2_data_integrity`.
- Ne pas exécuter de `migrate reset` sur une base réelle.
- Les marquages `is_duplicate` sont réversibles (`UPDATE … SET is_duplicate=false`) après revue, **avant** de retirer l’index unique partiel.

## Interdit

- Fusion automatique destructive.
- Hard delete de contacts lors de la détection.
- Application d’une migration destructive sur production sans backup + validation métier.
