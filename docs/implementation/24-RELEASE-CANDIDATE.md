# Stabilité — Release Candidate

Objectif : code **release candidate** (tests, lint, types, audit, build, deps).

Rapport : [`docs/final-audit/RELEASE-CANDIDATE.md`](../final-audit/RELEASE-CANDIDATE.md)

```bash
npm run lint && npm run typecheck && npm test && npm run audit:ci && npm run build
```
