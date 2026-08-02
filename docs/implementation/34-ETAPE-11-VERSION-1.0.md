# Étape 11 — Version 1.0.0

Quand tout fonctionne : tag Git, release notes, documentation finale,
sauvegarde, images Docker, version **1.0.0**.

---

## 1. Livrables

| Élément | Path / action |
|---|---|
| Version npm | `package.json` → `1.0.0` |
| Release notes | [docs/releases/v1.0.0.md](../releases/v1.0.0.md) |
| Doc finale | [docs/FINAL.md](../FINAL.md) |
| Tag Git | `v1.0.0` |
| Backup | `npm run backup` (avant bascule / release) |
| Images | `botoschool-app:1.0.0` · `botoschool-worker:1.0.0` |

---

## 2. Checklist release

- [ ] `npm run typecheck` · `npm run test` · `npm run build`
- [ ] `npm run validate:final` (si env dispo)
- [ ] Staging smoke OK
- [ ] DNS + SMTP checklists OK (même si encore DRY_RUN)
- [ ] Backup frais documenté / exécuté
- [ ] `package.json` version `1.0.0`
- [ ] Release notes publiées
- [ ] Commit release + tag annoté `v1.0.0`
- [ ] Images Docker build/tag `1.0.0` / `v1.0.0`
- [ ] (Option) `git push origin master --tags`

---

## 3. Commandes

```bash
# Qualité
npm run typecheck && npm run test && npm run build

# Backup (stack up)
npm run backup -- --compose=docker-compose.production.yml
# ou staging / local compose

# Images
npm run docker:tag-release
# ou :
# docker build -f Dockerfile --target app -t botoschool-app:1.0.0 .
# docker build -f Dockerfile.worker --target worker -t botoschool-worker:1.0.0 .

# Tag (après commit)
git tag -a v1.0.0 -m "Release v1.0.0 — BotoSchool Email Platform"
git show v1.0.0 --stat
```

---

## 4. Pourquoi / Impact / Risque / Rollback

| Change | Pourquoi | Impact | Risque | Rollback |
|---|---|---|---|---|
| Tag v1.0.0 | Point de restauration | Déploiements reproductibles | Tag poussé trop tôt | `git checkout` tag précédent / retag |
| Images versionnées | Rollback Docker | MTTD ↓ | Mauvais tag | Redeploy image antérieure |
| Backup pré-release | Données | Restore possible | Backup incomplet | `backup:verify` |

---

## 5. Post-release

- Ouvrir envoi réel uniquement via [12-PRODUCTION-CONTROLEE.md](../production/12-PRODUCTION-CONTROLEE.md)
- Ne jamais blaster des milliers d’emails au jour J
