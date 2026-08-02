# Checklist de recette CDC — R-01 à R-10

Base de test interne uniquement. Ne pas confondre avec une campagne réelle.

| ID | Domaine | Condition | Comment vérifier | Statut |
|----|---------|-----------|------------------|--------|
| R-01 | Import | Mapper CSV/XLSX, doublons, rapport acceptés/rejetés | Imports → charger fichier → Process | ☐ |
| R-02 | Éligibilité | Pas d'envoi sans statut ÉLIGIBLE + source + consentement | Qualifier un contact sans source → refus ; avec source → OK | ☐ |
| R-03 | Aperçu | Message personnalisé ; variables manquantes signalées | Templates → Aperçu ; lancer campagne avec variable absente → erreur | ☐ |
| R-04 | Mode test | Max 10 destinataires internes ; MODE TEST visible | Campagne `isTestMode` + contacts `isTestRecipient` → Envoi test | ☐ |
| R-05 | Approbation | Pas de prod sans validateur + DRY_RUN off + PRODUCTION_SENDING_ENABLED | Tenter schedule prod avec DRY_RUN=true → 422 | ☐ |
| R-06 | Idempotence | Retry / double clic ≠ 2 emails même étape | Relancer job BullMQ avec même `idempotencyKey` | ☐ |
| R-07 | Réponse/opt-out | Arrêt relances sur réponse, rebond dur, désinscription | Ouvrir `/unsubscribe/{token}` → contact UNSUBSCRIBED | ☐ |
| R-08 | Sécurité | Pas de secrets UI/logs ; RBAC ; audit | Paramètres SMTP = `***` ; AuditLog rempli | ☐ |
| R-09 | Observabilité | Erreur exploitable + santé file | `/api/health` ; logs worker | ☐ |
| R-10 | Export | Export filtré sans secrets ni exclus | Audit → Export CSV | ☐ |

## Flags d'environnement

```env
DRY_RUN=true
PRODUCTION_SENDING_ENABLED=false
```

Envoi production autorisé seulement si :

1. `DRY_RUN=false`
2. `PRODUCTION_SENDING_ENABLED=true`
3. Campagne `VALIDATED` et `isTestMode=false`
4. Contacts `ELIGIBLE` avec `source` + `consentBase`
5. Connecteur SMTP validé

## Signature recette

| Rôle | Nom | Date | Signature |
|------|-----|------|-----------|
| Responsable campagne | | | |
| Administrateur | | | |
| Auditeur | | | |
