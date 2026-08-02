# Guide Incident

Procédure courte pour diagnostiquer et contenir un incident production.

---

## 1. Sévérité

| Niveau | Exemples | SLA réponse |
|---|---|---|
| **P1** | Envois massifs incontrôlés, fuite secrets, DB down | Immédiat |
| **P2** | Worker mort, DLQ en hausse, SMTP down, login cassé | < 30 min |
| **P3** | Latence, cache stale, alerte soft | < 4 h |
| **P4** | Cosmétique / doc | Backlog |

---

## 2. Première minute (tous niveaux ≥ P2)

1. **Ne pas paniquer** — ouvrir ce guide + [02-ROLLBACK.md](./02-ROLLBACK.md)
2. Si doute sur les envois → **kill switch** (`PRODUCTION_SENDING_ENABLED=false`, `DRY_RUN=true`)
3. Noter heure UTC, tag image, dernière release
4. Annoncer sur le canal ops : `INCIDENT P? — symptôme — killswitch O/N`

---

## 3. Triage rapide

```bash
# Santé
curl -sS "$APP_URL/api/health/live"
curl -sS "$APP_URL/api/health/ready"

# Conteneurs
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=200 app worker

# Redis / queues (UI)
# → /ops/monitoring  (ops:read)
# → /ops/smtp /ops/dns
```

| Observation | Hypothèse | Action |
|---|---|---|
| ready KO DB | Postgres down / mauvais `DATABASE_URL` | Restart postgres, check disk |
| ready KO Redis | Redis down | Restart redis ; files BullMQ bloquées |
| Worker heartbeat stale | Worker crash / OOM | `docker compose … restart worker` ; logs |
| DLQ > 0 | Jobs email KO | Inspecter erreurs ; **ne pas** drain auto |
| Bounce rate ↑ | Contenu / liste / DNS | Pause campagnes ; check DNS/SMTP |
| 401 massifs | AUTH_SECRET changé | Restaurer / dual-key rotation |
| 5xx dashboard | Cache / DB lente | Voir logs Prisma ; TTL cache |

---

## 4. Contenir

| Risque | Contre-mesure |
|---|---|
| Envoi | Kill switch + pause campagnes |
| Charge | Baisser `EMAIL_QUEUE_CONCURRENCY` ; scale workers avec prudence |
| Data | Stop writes non essentiels ; **ne pas** restore sans GO |
| Secret | Rotation ([SECRET-ROTATION](../runbooks/SECRET-ROTATION.md)) |
| ESP | Couper credentials côté fournisseur si compromission |

---

## 5. Remédier

Ordre préféré :

1. Fix config / redémarrage ciblé
2. Rollback image (même schéma DB)
3. Restore snapshot (dernier recours data)

Après fix :

- [ ] Health ready OK
- [ ] Monitoring vert 15 min
- [ ] Campagnes reprises **volontairement**
- [ ] Backup post-incident

---

## 6. Journal d’incident (copier)

```
Date UTC :
Sévérité :
Détecté par :
Symptôme :
Kill switch : oui / non
Cause racine :
Actions :
Durée :
Suivi (ticket) :
```

---

## 7. Post-mortem (P1/P2)

Sous 48 h : timeline, cause, correctifs, owner, date de clôture.
Mettre à jour ce guide si une étape a manqué.
