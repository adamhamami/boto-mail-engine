# Backups (Phase 10)

Ce dossier reçoit les sauvegardes générées par `npm run backup`.

Structure d’un snapshot :

```
backups/
  2026-08-01T05-45-00-000Z/
    manifest.json
    VERIFY.json
    postgres.dump
    redis/dump.rdb
    redis/appendonly.aof
    uploads/...
```

Les fichiers de backup sont **gitignored**. Ne jamais committer de dumps.
