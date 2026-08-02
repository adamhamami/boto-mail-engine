# API — BotoSchool Email Platform

> Documentation générée pour la Phase 1. Les endpoints seront implémentés module par module.

## Conventions

### Format de réponse

**Succès :**
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "total": 100 }
}
```

**Erreur :**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": { ... }
  }
}
```

### Authentification

Toutes les routes (sauf `/api/auth/*` et `/api/health`) requièrent une session Auth.js valide.

Header : Cookie de session (httpOnly)

### Codes HTTP

| Code | Usage |
|------|-------|
| 200 | Succès |
| 201 | Création |
| 400 | Validation échouée |
| 401 | Non authentifié |
| 403 | Permission insuffisante |
| 404 | Ressource introuvable |
| 409 | Conflit (doublon) |
| 422 | Campagne non validée |
| 429 | Rate limit |
| 500 | Erreur serveur |

---

## Endpoints planifiés

### Health

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/health` | Health check (DB + Redis) |

### Authentication

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/auth/signin` | Connexion |
| POST | `/api/auth/signout` | Déconnexion |
| GET | `/api/auth/session` | Session courante |

### Users

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/users` | `users:read` |
| POST | `/api/users` | `users:write` |
| GET | `/api/users/:id` | `users:read` |
| PATCH | `/api/users/:id` | `users:write` |
| DELETE | `/api/users/:id` | `users:delete` |

### Organizations

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/organizations` | `organizations:read` |
| POST | `/api/organizations` | `organizations:write` |
| GET | `/api/organizations/:id` | `organizations:read` |
| PATCH | `/api/organizations/:id` | `organizations:write` |
| DELETE | `/api/organizations/:id` | `organizations:delete` |

### Contacts

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/contacts` | `contacts:read` |
| POST | `/api/contacts` | `contacts:write` |
| GET | `/api/contacts/:id` | `contacts:read` |
| PATCH | `/api/contacts/:id` | `contacts:write` |
| DELETE | `/api/contacts/:id` | `contacts:delete` |
| POST | `/api/contacts/:id/qualify` | `contacts:qualify` |
| GET | `/api/contacts/duplicates` | `contacts:read` |

### Imports

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/imports` | `imports:read` |
| POST | `/api/imports` | `imports:write` |
| GET | `/api/imports/:id` | `imports:read` |
| POST | `/api/imports/:id/process` | `imports:write` |

### Segments

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/segments` | `segments:read` |
| POST | `/api/segments` | `segments:write` |
| GET | `/api/segments/:id` | `segments:read` |
| PATCH | `/api/segments/:id` | `segments:write` |
| DELETE | `/api/segments/:id` | `segments:delete` |
| POST | `/api/segments/:id/refresh` | `segments:write` |

### Templates

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/templates` | `templates:read` |
| POST | `/api/templates` | `templates:write` |
| GET | `/api/templates/:id` | `templates:read` |
| PATCH | `/api/templates/:id` | `templates:write` |
| DELETE | `/api/templates/:id` | `templates:delete` |
| POST | `/api/templates/:id/preview` | `templates:read` |

### Sequences

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/sequences` | `sequences:read` |
| POST | `/api/sequences` | `sequences:write` |
| GET | `/api/sequences/:id` | `sequences:read` |
| PATCH | `/api/sequences/:id` | `sequences:write` |
| DELETE | `/api/sequences/:id` | `sequences:delete` |

### Campaigns

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/campaigns` | `campaigns:read` |
| POST | `/api/campaigns` | `campaigns:write` |
| GET | `/api/campaigns/:id` | `campaigns:read` |
| PATCH | `/api/campaigns/:id` | `campaigns:write` |
| DELETE | `/api/campaigns/:id` | `campaigns:delete` |
| POST | `/api/campaigns/:id/validate` | `campaigns:validate` |
| POST | `/api/campaigns/:id/schedule` | `campaigns:send` |
| POST | `/api/campaigns/:id/cancel` | `campaigns:write` |
| GET | `/api/campaigns/:id/recipients` | `campaigns:read` |

### Dashboard

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/dashboard/stats` | `dashboard:read` |
| GET | `/api/dashboard/charts` | `dashboard:read` |

### Audit

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/audit` | `audit:read` |
| GET | `/api/audit/export` | `audit:export` |

### Settings

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/settings` | `settings:read` |
| PATCH | `/api/settings` | `settings:write` |

### Suppression List

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/suppression` | `suppression:read` |
| POST | `/api/suppression` | `suppression:write` |
| DELETE | `/api/suppression/:id` | `suppression:write` |

### Responses

| Méthode | Route | Permission |
|---------|-------|------------|
| GET | `/api/responses` | `responses:read` |
| PATCH | `/api/responses/:id` | `responses:write` |

### Webhooks

| Méthode | Route | Auth |
|---------|-------|------|
| POST | `/api/webhooks/mail` | Signature provider |
