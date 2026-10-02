# Guide de démarrage — BotoSchool Emailing

Guide produit pour utiliser l’interface au quotidien : démarrage, rubriques, fonctionnalités et **explication de chaque bouton**.

Public : utilisateurs métier, administrateurs, nouveaux arrivants.

Compléments techniques : [DEVELOPER.md](./DEVELOPER.md) · [ADMIN.md](./ADMIN.md) · [OPERATOR.md](./OPERATOR.md).

---

## 1. Démarrer le projet (local)

### Prérequis

- Node.js 20+
- Docker Desktop
- Compte seed (après `npm run db:seed`) : email `admin@botoschool.com` — mot de passe dans `.credentials.local` (jamais committer)

### Commandes

```bash
npm install
cp .env.example .env          # si pas encore de .env
npm run docker:up             # Postgres :5433 · Redis :6379
npm run docker:tools          # Mailpit SMTP de test :8025
npx prisma migrate deploy
npm run db:seed               # première fois
npm run admin:password "MotDePasseFort12!"   # recommandé

# Terminal 1
npm run dev                   # http://localhost:3000

# Terminal 2
npm run worker                # obligatoire pour imports / envois / webhooks
```

Ouvrir **http://localhost:3000/login**.

### Sécurité d’envoi (à connaître)

| Variable | Défaut sûr | Signification |
|---|---|---|
| `DRY_RUN` | `true` | Simule l’envoi (pas d’email réel) |
| `PRODUCTION_SENDING_ENABLED` | `false` | Bloque l’envoi réel même hors DRY_RUN |

Tant que ces valeurs sont sûres, vous pouvez tester toute l’UI sans risque.

---

## 2. Parcours métier recommandé

```
Imports → Contacts (rendre éligible) → Segments
    → Modèles → Séquences → Campagnes (assistant)
    → Réponses / Tâches commerciales
    → Ops si problème d’envoi
```

---

## 3. Shell global (toutes les pages)

### Sidebar (menu gauche)

| Entrée | Ouvre | À quoi ça sert |
|---|---|---|
| **BotoSchool** (logo) | `/dashboard` | Retour accueil |
| **Tableau de bord** | `/dashboard` | KPIs et activité |
| **Contacts** | `/contacts` | Base destinataires |
| **Organisations** | `/organizations` | Entités / domaines |
| **Imports** | `/imports` | Chargement CSV/XLSX |
| **Segments** | `/segments` | Audiences filtrées |
| **Modèles** | `/templates` | Emails HTML |
| **Séquences** | `/sequences` | Enchaînements d’emails / délais |
| **Campagnes** | `/campaigns` | Envois validés |
| **Réponses** | `/responses` | Réponses reçues |
| **Exclusions** | `/suppression` | Liste noire |
| **Tâches commerciales** | `/sales-tasks` | Relances commerciales |
| **Audit** | `/audit` | Journal des actions |
| **Conformité** | `/compliance` | DSR / anonymisation / rétention |
| **Paramètres** | `/settings` | Marque + SMTP |
| **Utilisateurs** | `/users` | Comptes & rôles |
| **Santé technique** | `/ops` | État système |
| **Santé SMTP** | `/ops/smtp` | Diagnostic envoi |
| **Santé DNS** | `/ops/dns` | SPF / DKIM / DMARC |
| **Monitoring** | `/ops/monitoring` | Métriques & alertes |

Les entrées visibles dépendent de votre **rôle** (RBAC). Footer : fuseau **Africa/Casablanca**.

### En-tête

| Contrôle | Explication |
|---|---|
| **Icône menu** (SidebarTrigger) | Replie / déplie la sidebar |
| **Titre de page** | Indique la rubrique courante |
| **Changer le thème** | Alterne clair / sombre |
| **Avatar → Déconnexion** | Ferme la session et renvoie vers `/login` |

---

## 4. Connexion — `/login`

| Élément | Explication |
|---|---|
| **Email** | Identifiant du compte |
| **Mot de passe** | Secret du compte |
| **Se connecter** | Authentifie puis ouvre le tableau de bord |
| **Contacter l'administrateur** | Lien placeholder (prévoir contact interne) |

Erreur typique : « Email ou mot de passe incorrect. »

---

## 5. Tableau de bord — `/dashboard`

**Rôle :** vue d’ensemble de la prospection (rafraîchi ~60 s).

### Ce que vous voyez

- Bandeau : fuseau, connecteur mail, dernier événement
- **KPIs** : contacts importés / éligibles, envoyés, délivrés, rebonds, réponses, réponses positives, désinscriptions, demandes de démo, tâches commerciales, campagnes actives, file / DLQ
- Quotas horaires / journaliers
- Erreurs récentes
- Graphiques 14 jours (envois, ouvertures, réponses)
- Campagnes récentes + tableau journalier

### Boutons / liens

| Contrôle | Explication |
|---|---|
| **Réessayer** | Recharge les stats en cas d’erreur API |
| **Santé technique** | Ouvre `/ops` pour diagnostiquer |
| Nom d’une campagne | Ouvre le détail `/campaigns/{id}` |

---

## 6. Contacts — `/contacts`

**Rôle :** créer, chercher, qualifier et supprimer des contacts.

| Contrôle | Explication |
|---|---|
| **Nouveau contact** | Ouvre le formulaire de création |
| Dialog — **Email / Prénom / Nom** | Identité minimale du contact |
| **Créer** | Enregistre le contact (`POST`) |
| **Rechercher…** | Filtre instantané email / nom |
| **Filtre statut** | Tous / Importé / Éligible / etc. |
| **Rendre éligible** | Demande Source + Base légale, puis passe le contact en **Éligible** (requis avant envoi) |
| **Supprimer** | Supprime le contact |

Empty : « Aucun contact trouvé ».

---

## 7. Organisations — `/organizations`

**Rôle :** gérer les organisations liées aux contacts.

| Contrôle | Explication |
|---|---|
| **Nouvelle organisation** | Ouvre le formulaire |
| **Nom / Domaine** | Identifiants de l’organisation |
| **Créer** | Enregistre |
| **Rechercher…** | Filtre nom / domaine |
| **Supprimer** | Supprime l’organisation |

---

## 8. Imports — `/imports`

**Rôle :** importer une liste CSV ou XLSX (traitement asynchrone via worker).

### Boutons du wizard

| Contrôle | Explication |
|---|---|
| **Nouvel import** | Démarre l’assistant |
| **1. Fichier** | Choisir le fichier CSV/XLSX |
| **Valider le fichier** | Upload + analyse des colonnes |
| **2. Mapping colonnes** | Associer chaque colonne fichier → champ BotoSchool (ou « — ignorer — ») |
| **Aperçu** | Enregistre le mapping et montre un échantillon |
| **3. Aperçu & confirmation** | Contrôle final avant traitement |
| **Confirmer & traiter** | Lance le job d’import (worker) |

L’historique des imports s’affiche sous le wizard.

---

## 9. Segments — `/segments`

**Rôle :** définir une audience (filtres) pour les campagnes.

| Contrôle | Explication |
|---|---|
| **Nouveau segment** | Ouvre le formulaire |
| **Nom / Description** | Libellés du segment |
| **Ville, Type établissement, Taille, Statut, Tags** | Critères de filtre |
| **Uniquement éligibles** | Limite aux contacts éligibles (recommandé) |
| **Aperçu volume** | Estime combien de contacts matchent |
| **Créer** | Enregistre le segment |
| **Rechercher…** | Filtre la liste |
| **Rafraîchir** (ligne) | Recalcule le volume du segment |

---

## 10. Modèles — `/templates`

**Rôle :** templates d’email (objet + HTML).

| Contrôle | Explication |
|---|---|
| **Nouveau modèle** | Création |
| **Nom / Objet / Corps HTML** | Contenu du mail |
| **Créer** | Enregistre |
| **Rechercher…** | Filtre |
| **Aperçu** | Affiche un rendu du modèle |
| **Supprimer** | Supprime le modèle |

---

## 11. Séquences — `/sequences`

**Rôle :** enchaîner emails et délais (parcours multi-étapes).

| Contrôle | Explication |
|---|---|
| **Nouvelle séquence** | Création |
| **Nom / Description** | Identité |
| Type d’étape **Email** / **Délai** | Email = modèle ; Délai = Jours/Heures |
| **Ajouter une étape** | Ajoute une étape dans le brouillon |
| **Créer** | Enregistre la séquence |
| **Rechercher…** | Filtre |
| **Supprimer** | Supprime |

---

## 12. Campagnes — `/campaigns`

**Rôle :** piloter le cycle de vie d’un envoi (brouillon → test → validation → lancement).

### Boutons liste

| Contrôle | Explication |
|---|---|
| **Assistant (6 étapes)** | Wizard guidé `/campaigns/new` (recommandé) |
| **Création rapide** | Crée une campagne en une dialog (mode test) |
| Champs création rapide | Nom, Description, Segment, Source Modèle **ou** Séquence |
| **Créer** | Crée en `isTestMode: true` |
| **Recherche + filtre statut** | Filtre la liste |
| Nom de campagne | Ouvre le détail |
| **Envoi test** | Programme un envoi de test (brouillon / testé) |
| **Soumettre** | Envoie en validation |
| **Valider** | Approuve la campagne |
| **Rejeter** | Refuse la campagne |
| **Lancer** | Programme l’envoi (campagne validée) |
| **Pause** | Suspend l’envoi |
| **Reprendre** | Reprend après pause |
| **Annuler** | Annule la campagne |
| **Supprimer** | Supprime un **brouillon** uniquement |

### Assistant `/campaigns/new` (6 étapes)

| Étape | Contenu |
|---|---|
| **1. Audience** | Nom, description, segment |
| **2. Séquence** | Séquence (recommandé) ou modèle unique + mode test |
| **3. Personnalisation** | Ajustements contenus |
| **4. Calendrier et quotas** | Fuseau, plages horaires, quotas |
| **5. Test** | Envoi test |
| **6. Approbation et programmation** | Soumission / validation / schedule |

| Bouton | Explication |
|---|---|
| **Précédent** | Étape précédente |
| **Suivant** | Enregistre (création/maj) et avance |
| **Lancer l'envoi test** | Programme le test |
| **Soumettre validation** | Demande d’approbation |
| **Valider et programmer** | Valide + schedule + ouvre le détail |
| **Voir la campagne** | Va au détail |

### Détail `/campaigns/[id]`

| Contrôle | Explication |
|---|---|
| **Retour** | Revient à la liste |
| KPIs / destinataires | Lecture seule (pas d’actions lifecycle ici) |

---

## 13. Réponses — `/responses`

**Rôle :** traiter les réponses email inbound.

| Contrôle | Explication |
|---|---|
| **Rechercher…** | Filtre email / nom |
| **Traiter** | Ouvre le dialog de qualification |
| **Statut du contact / Notes** | Mise à jour métier |
| **Enregistrer** | Sauve le traitement |
| **Précédent / Suivant** | Pagination |

---

## 14. Exclusions — `/suppression`

**Rôle :** emails qui ne doivent plus recevoir de messages.

| Contrôle | Explication |
|---|---|
| **Ajouter un email** | Ajoute à la liste noire |
| **Email / Raison / Notes** | Motif (désinscription, rebond dur, etc.) |
| **Ajouter** | Enregistre |
| **Recherche + filtre raison** | Filtre |
| **Retirer** | Enlève de la liste |

---

## 15. Tâches commerciales — `/sales-tasks`

**Rôle :** suivi des leads générés (ex. après réponse).

| Contrôle | Explication |
|---|---|
| **Réessayer** | Recharge en cas d’erreur |
| **Terminer** | Marque la tâche comme terminée (confirmation) |

---

## 16. Audit — `/audit`

**Rôle :** journal d’actions (traçabilité).

| Contrôle | Explication |
|---|---|
| **Exporter CSV** | Télécharge l’export |
| Filtres **Module / Action** | Affine le journal |
| **Précédent / Suivant** | Pagination |

---

## 17. Conformité — `/compliance`

**Rôle :** demandes CNDP / droit des personnes, export, anonymisation, rétention.

| Contrôle | Explication |
|---|---|
| **Enregistrer la demande** | Crée une demande (type, email, contact, notes) |
| **Exporter (JSON)** | Export des données d’un contact |
| **Anonymiser** | Anonymise le contact (irréversible — confirmation) |
| **Rétention (dry-run)** | Simule la purge de rétention |
| **Rétention (réel)** | Exécute la rétention (confirmation) |
| **Précédent / Suivant** | Liste des demandes |

---

## 18. Paramètres — `/settings`

**Rôle :** identité d’envoi et test SMTP.

| Contrôle | Explication |
|---|---|
| Champs généraux | Nom entreprise, expéditeur, reply-to, fuseau, rate limit |
| **Enregistrer** | Sauve la config générale |
| Bloc SMTP (souvent lecture seule env) | Hôte, port, TLS, identifiants |
| **Tester la connexion SMTP** | Vérifie la connectivité SMTP (sans campagne) |

---

## 19. Utilisateurs — `/users`

**Rôle :** comptes et rôles RBAC.

| Contrôle | Explication |
|---|---|
| **Nouvel utilisateur** | Création |
| **Email / Nom / Mot de passe / Rôle** | Identité + permissions |
| **Créer** | Enregistre |
| **Rechercher…** | Filtre |
| **Supprimer** | Supprime le compte |

Rôles typiques : Administrateur, Responsable campagne, Commercial, Auditeur (voir [ADMIN.md](./ADMIN.md)).

---

## 20. Ops — santé & monitoring

### Santé technique — `/ops`

| Contrôle | Explication |
|---|---|
| **Réessayer** | Recharge le health check |
| **Diagnostic SMTP détaillé** | → `/ops/smtp` |
| **Vérification DNS…** | → `/ops/dns` |
| **Monitoring & alertes** | → `/ops/monitoring` |

Affiche Postgres, Redis, workers, files, erreurs.

### Santé SMTP — `/ops/smtp`

| Contrôle | Explication |
|---|---|
| **Tester maintenant** | Lance un check SMTP (pas d’envoi campagne) |
| **Réessayer** | Recharge |

### Santé DNS — `/ops/dns`

| Contrôle | Explication |
|---|---|
| **Domaine (optionnel)** | Domaine à vérifier |
| **Vérifier maintenant** | SPF / DKIM / DMARC / MX / rDNS |
| **Réessayer** | Recharge |

### Monitoring — `/ops/monitoring`

| Contrôle | Explication |
|---|---|
| **Rafraîchir** | Met à jour métriques / alertes |
| **Réessayer** | En cas d’erreur |
| **Export Prometheus** | Métriques scrape |
| **Grafana** | Ouvre Grafana si configuré |
| Ancres **Alertes / Erreurs / Workers / SMTP** | Scroll vers la section |
| Liens live/ready | Health HTTP public |

---

## 21. FAQ rapide

**Pourquoi aucun email n’arrive ?**  
Vérifier que le **worker** tourne, Mailpit (`:8025`) si SMTP local, et que `DRY_RUN` / `PRODUCTION_SENDING_ENABLED` sont cohérents avec votre intention.

**Pourquoi « Rendre éligible » ?**  
Les contacts doivent être **éligibles** (base légale) avant d’entrer dans une campagne réelle.

**Qui voit quoi ?**  
La sidebar filtre selon les permissions du rôle. Les API refusent aussi les actions non autorisées.

**Où changer mon mot de passe admin ?**  
Côté ops : `npm run admin:password "NouveauMotDePasse"`.

---

## 22. Liens utiles

| Besoin | Lien |
|---|---|
| App locale | http://localhost:3000 |
| Mailpit | http://localhost:8025 |
| Doc finale v1.0 | [../FINAL.md](../FINAL.md) |
| Dev setup | [DEVELOPER.md](./DEVELOPER.md) |
| Admin métier | [ADMIN.md](./ADMIN.md) |
| Ops | [OPERATOR.md](./OPERATOR.md) |
