# syntax=docker/dockerfile:1.7
# BotoSchool Email Platform — multi-stage léger (Phase 7)
# Targets : deps | builder | app | worker

# ─── Stage 1: Dependencies (cache npm) ───────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts \
  && npm cache clean --force

# ─── Stage 2: Build Next.js standalone + Prisma client ───────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
# Contexte filtré par .dockerignore (pas de .env / tests / .git)
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV AUTH_SECRET="build-time-secret-not-used-in-runtime-32chars"
ENV WEBHOOK_SECRET="build-time-webhook-secret-not-used-32ch"
ENV APP_URL="https://build.local"
ENV AUTH_URL="https://build.local"

RUN npx prisma generate \
  && npm run build

# ─── Stage 3: App runner (image légère Next standalone) ──────────────────────
FROM node:20-alpine AS app
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache libc6-compat openssl wget \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/logs /app/.tmp \
  && chown -R nextjs:nodejs /app/logs /app/.tmp

# Standalone Next.js (pas de node_modules complet)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma migrate + client (runtime ops)
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/adapter-pg ./node_modules/@prisma/adapter-pg
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg ./node_modules/pg
# Dépendances transitives de `pg` (hoistées par npm)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-cloudflare ./node_modules/pg-cloudflare
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-int8 ./node_modules/pg-int8
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pgpass ./node_modules/pgpass
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/xtend ./node_modules/xtend
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/split2 ./node_modules/split2

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/live || exit 1

CMD ["node", "server.js"]

# ─── Stage 4: Worker runner (prod deps + tsx, sans Next) ─────────────────────
FROM node:20-alpine AS worker
WORKDIR /app

ENV NODE_ENV=production
ENV WORKER_ENABLED=true

RUN apk add --no-cache libc6-compat openssl wget \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 worker \
  && mkdir -p /app/logs /app/.tmp \
  && chown -R worker:nodejs /app/logs /app/.tmp

COPY package.json package-lock.json ./
# Dépendances runtime uniquement + tsx pour exécuter les workers TS
RUN npm ci --omit=dev --ignore-scripts \
  && npm install tsx@4.23.1 --omit=dev --no-save \
  && npm cache clean --force

COPY --from=builder --chown=worker:nodejs /app/prisma ./prisma
COPY --from=builder --chown=worker:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=worker:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=worker:nodejs /app/src ./src
COPY --from=builder --chown=worker:nodejs /app/src/generated ./src/generated
COPY --chown=worker:nodejs scripts/docker-worker-healthcheck.mjs ./scripts/docker-worker-healthcheck.mjs

# Client Prisma généré (évite generate au runtime)
COPY --from=builder --chown=worker:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=worker:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER worker

HEALTHCHECK --interval=30s --timeout=8s --start-period=50s --retries=3 \
  CMD node scripts/docker-worker-healthcheck.mjs

CMD ["npx", "tsx", "src/workers/index.ts"]
