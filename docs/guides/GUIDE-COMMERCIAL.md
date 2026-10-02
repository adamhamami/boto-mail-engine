# Guide commercial — parcours pratique BotoSchool

Comprendre **la logique visuelle** du produit et les **étapes à suivre** au quotidien.  
Public : commerciaux, responsables campagne, nouveaux utilisateurs métier.

App : http://localhost:3000 (ou URL de prod)

---

## 1. En une phrase

BotoSchool sert à **importer des contacts → les rendre éligibles → cibler un segment → préparer un email/séquence → lancer une campagne validée → traiter les réponses**.

```
IMPORT  →  CONTACTS  →  SEGMENT  →  MODÈLE / SÉQUENCE  →  CAMPAGNE  →  RÉPONSES / TÂCHES
```

---

## 2. Carte mentale (menu gauche)

| Zone du menu | Votre rôle |
|---|---|
| **Tableau de bord** | Voir l’activité (envois, réponses, alertes) |
| **Imports / Contacts / Organisations** | Alimenter et qualifier la base |
| **Segments** | Choisir *qui* reçoit |
| **Modèles / Séquences** | Choisir *quoi* et *dans quel ordre* |
| **Campagnes** | Décider *quand* et *lancer* (avec validation) |
| **Réponses / Tâches commerciales** | Suivre et convertir |
| **Exclusions** | Ne plus écrire à quelqu’un |
| Ops / Audit / Conformité / Users | Admin / technique (pas le flux commercial quotidien) |

---

## 3. Étapes à suivre (ordre recommandé)

### Étape 1 — Importer la liste

1. Menu **Imports** → **Nouvel import**
2. Choisir le fichier CSV/XLSX → **Valider le fichier**
3. Mapper les colonnes (email, nom, etc.) → **Aperçu**
4. **Confirmer & traiter**

*Résultat :* des contacts apparaissent dans **Contacts** (souvent statut *Importé*).

---

### Étape 2 — Rendre les contacts éligibles

1. Menu **Contacts**
2. Sur chaque contact (ou ceux utiles) → **Rendre éligible**
3. Indiquer la **source** et la **base légale**

*Pourquoi :* sans statut **Éligible**, la personne ne doit pas recevoir de campagne réelle.

---

### Étape 3 — Créer le segment (audience)

1. Menu **Segments** → **Nouveau segment**
2. Remplir les filtres (ville, type, tags…)
3. Cocher **Uniquement éligibles** (recommandé)
4. **Aperçu volume** → vérifier le nombre → **Créer**

*Résultat :* une cible claire pour la campagne.

---

### Étape 4 — Préparer le message

**Option A — un seul email**

1. **Modèles** → **Nouveau modèle**
2. Nom, objet, corps HTML → **Créer**
3. **Aperçu** pour contrôler

**Option B — plusieurs emails (recommandé)**

1. Créer d’abord les **Modèles**
2. **Séquences** → **Nouvelle séquence**
3. Ajouter des étapes **Email** (+ **Délai** entre les mails) → **Créer**

---

### Étape 5 — Lancer la campagne

1. **Campagnes** → **Assistant (6 étapes)** *(préférer à la création rapide)*
2. Enchaîner :
   - **Audience** → segment
   - **Séquence** → séquence ou modèle + mode test si besoin
   - **Calendrier / quotas** → horaires d’envoi
   - **Test** → **Lancer l'envoi test**
   - **Approbation** → **Soumettre** puis un validateur **Valide** / **Lance**

*Logique visuelle des boutons campagne :*

| Bouton | Signifie |
|---|---|
| **Envoi test** | Essai contrôlé |
| **Soumettre** | Demande d’accord |
| **Valider** / **Rejeter** | Décision manager |
| **Lancer** | Départ de l’envoi |
| **Pause** / **Reprendre** | Couper / reprendre |
| **Annuler** | Stop définitif |

---

### Étape 6 — Suivre et convertir

1. **Tableau de bord** → volume, réponses, rebonds
2. **Réponses** → **Traiter** (statut + notes)
3. **Tâches commerciales** → **Terminer** quand le lead est traité
4. Si besoin : **Exclusions** → **Ajouter un email** (ne plus contacter)

---

## 4. Ce que vous voyez sur le Dashboard

Lisez-le comme un **tableau de bord commercial** :

- **Envoyés / Délivrés / Ouvertures / Réponses** → performance
- **Rebonds / Désinscriptions** → qualité de la liste
- **Campagnes actives / File** → “est-ce que ça tourne ?”
- Lien **Santé technique** → à remonter à l’admin si blocage

---

## 5. Règles d’or (éviter les erreurs)

1. **Toujours** importer → éligible → segment → message → campagne  
2. Ne pas lancer sans **test** si vous débutez  
3. Respecter la **validation** (Soumettre → Valider → Lancer)  
4. Traiter les **réponses** rapidement (sinon les leads meurent)  
5. Mettre en **exclusion** dès qu’on demande d’arrêter  

---

## 6. Mini check-list avant un envoi

- [ ] Import terminé  
- [ ] Contacts **éligibles**  
- [ ] Segment créé + volume OK  
- [ ] Modèle / séquence prêts  
- [ ] Campagne testée  
- [ ] Campagne **validée** puis **lancée**  
- [ ] Worker / envoi OK (si doute → admin / Ops)  

---

## 7. Où aller plus loin

- Détail de **chaque bouton** : [GUIDE-DEMARRAGE.md](./GUIDE-DEMARRAGE.md)  
- Admin / rôles : [ADMIN.md](./ADMIN.md)  
