# Guide Staging — pré-production complète

Environnement **Mailpit + DRY_RUN** pour valider imports, campagnes, workers,
webhooks, quotas, pause/reprise et reprise après crash — **sans envoi réel**.

Gates figées dans compose :

| Variable | Valeur staging |
|---|---|
| `DRY_RUN` | `true` |
| `PRODUCTION_SENDING_ENABLED` | `false` |
| SMTP | `mailpit:1025` |

---

## 1. Démarrage

```bash
cp .env.staging.example .env.staging
# Renseigner APP_URL / SMTP_FROM_EMAIL si besoin
npm run docker:secrets
npm run deploy:staging
# ou : npm run docker:staging puis migrate/seed manuels
```

| Service | URL |
|---|---|
| App | http://localhost:3001 |
| Mailpit | http://localhost:8026 |
| Postgres | localhost:5434 |
| Redis | localhost:6380 |

Mot de passe admin :

```bash
# depuis l’hôte, DATABASE_URL pointant sur staging :5434
npm run admin:password "MotDePasseStaging12!"
```

---

## 2. Smoke automatisé

```bash
npm run smoke:staging
# optionnel : STAGING_RUN_RECETTE=1 npm run smoke:staging
# optionnel : STAGING_SKIP_WORKER_RESTART=1 …
```

Écrit `docs/final-audit/staging-smoke.json`.

Couverture auto :

| Thème | Comment |
|---|---|
| Health live/ready | HTTP |
| Mailpit UI | HTTP |
| Worker Docker | `compose ps` + health |
| Reprise après crash | `restart worker` + ready |
| Imports / quotas / pause-fenêtre / erreurs / webhooks HMAC | `staging-engine-scenarios.ts` |
| Recette CDC R-01–R-10 | opt-in `STAGING_RUN_RECETTE=1` |

---

## 3. Checklist manuelle UI (obligatoire avant “staging GO”)

### Imports
- [ ] Upload CSV/XLSX → rapport accepted/rejected
- [ ] Confirm + process → contacts créés
- [ ] Doublons détectés

### Campagnes
- [ ] Créer DRAFT → test recipients
- [ ] Soumettre → `PENDING_VALIDATION`
- [ ] Valider → `VALIDATED`
- [ ] Programmer → `SCHEDULED` → `RUNNING` (worker)

### Pause / reprise
- [ ] Pause campagne RUNNING → jobs retirés / plus d’envoi
- [ ] Reprise → reprise destinataires non SENT

### Quotas
- [ ] `/ops/monitoring` : quotas / files
- [ ] (Option) baisser `SEND_QUOTA_*` en staging et constater skip/delay

### Webhooks
- [ ] POST `/api/webhooks/mail` avec HMAC valide (secret staging)
- [ ] Signature invalide → 401
- [ ] Événement bounce/unsubscribe met à jour contact / suppression

### Erreurs
- [ ] Job DLQ visible si échec définitif (simuler via worker logs)
- [ ] `/ops/monitoring` `#erreurs` : rates / DLQ

### Workers / crash
- [ ] `docker compose -f docker-compose.staging.yml restart worker`
- [ ] Heartbeat revient OK sur `/ops/monitoring`
- [ ] Campagne RUNNING reprend (scheduler scan)

### Gates
- [ ] Aucun mail réel hors Mailpit
- [ ] `DRY_RUN=true` confirmé dans `/ops` provider

---

## 4. Commandes utiles

```bash
docker compose -f docker-compose.staging.yml --env-file .env.staging logs -f worker
docker compose -f docker-compose.staging.yml restart worker
npm run docker:down:staging
npm run test:recette
```

---

## 5. Voir aussi

- [Deployment.md](../Deployment.md)
- [OPERATOR.md](../guides/OPERATOR.md)
- [30-ETAPE-7-STAGING.md](../implementation/30-ETAPE-7-STAGING.md)
- [Recette.md](../Recette.md)
