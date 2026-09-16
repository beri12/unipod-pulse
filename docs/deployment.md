# Deployment

Four processes and two datastores:

| Service | What it does | Scale when |
|---|---|---|
| `web` | Next.js server | Page load latency rises |
| `api` | HTTP API, retrieval, answering | Chat latency rises |
| `worker` | Ingestion, embedding, transcription, summarising | Queue depth grows |
| `migrate` | One-shot `prisma migrate deploy` | — |
| `postgres` | PostgreSQL 16 + pgvector | Data volume or query latency |
| `redis` | BullMQ queues | Rarely |

## With Docker Compose

```bash
cp .env.example .env     # fill in real values
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api worker
```

Migrations run first as a one-shot job; `api` and `worker` wait for it to
complete successfully, so no service ever starts against an un-migrated schema.

All three application images build from the repository root (workspace packages
have to resolve), run as the unprivileged `node` user, and ship only production
dependencies. The API and web images declare health checks against their own
endpoints.

## On a platform (Vercel, Railway, Render, Fly)

- **Web** — deploy `apps/web`. Set `NEXT_PUBLIC_API_URL` and
  `NEXT_PUBLIC_DEMO_MODE` at **build** time; Next inlines them.
- **API** — deploy `apps/api` with `pnpm --filter @unipods/api start:prod`.
  Needs the database, Redis, storage and AI variables.
- **Worker** — deploy `apps/worker` with `node apps/worker/dist/main.js`. Same
  variables as the API, minus the HTTP ones. It serves no port; if your platform
  requires one, use a background-worker process type.
- **Database** — any managed PostgreSQL 16 that can install `vector`, `pg_trgm`
  and `unaccent`. Behind PgBouncer, set `DIRECT_DATABASE_URL` to the non-pooled
  URL so migrations use a direct connection.
- **Migrations** — run `pnpm db:deploy` as a release step.

## Behind a reverse proxy

Terminate TLS at the proxy and forward to `web:3000` and `api:3001`. The API
sets `trust proxy`, so it reads `X-Forwarded-For` and rate limiting sees real
client IPs. Set `CORS_ORIGINS` to the web app's public origin and `API_URL` to
the API's, because `API_URL` is what signed local-storage links are built from.

## Before going live

- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` generated with
      `openssl rand -base64 48`. The API refuses to start in production with the
      example values.
- [ ] `DEMO_MODE=false`, and the demo data removed if it was ever seeded.
- [ ] `STORAGE_DRIVER=s3` with a **private** bucket. The local driver keeps
      files on the container's disk, which does not survive a redeploy and is
      not shared between instances.
- [ ] `CORS_ORIGINS` set to real origins, not `*` and not localhost.
- [ ] `AI_PROVIDER=openai` with a key, unless you deliberately want extractive
      answers.
- [ ] `RATE_LIMIT_*` tuned for your community's size.
- [ ] Database backups configured. Everything except the objects in storage
      lives in PostgreSQL.
- [ ] `/api/health` wired to your uptime monitor. It reports the database, Redis
      and storage individually.

## Operating it

- **`/admin`** shows dependency health, queue depths (including failed jobs) and
  the active AI provider.
- **Failed processing** shows on the documents and meetings pages with the
  reason, and can be retried from there. Jobs also retry automatically three
  times with exponential backoff.
- **A crashed worker mid-job** is not fatal: the claim it held becomes
  reclaimable after fifteen minutes, and a retry picks the item up.
- **Scaling the worker** is the usual answer to a backlog; queues are the
  coordination point and concurrency is set per queue, with transcription
  deliberately serialised because it is the expensive one.

## Costs to expect

With `AI_PROVIDER=openai`, ingestion costs one embedding call per batch of
chunks (batched up to 96 inputs per request), transcription is charged per
minute of audio, and each question costs one embedding plus one completion. The
offline provider costs nothing and needs no key, at the quality trade-off
described in [ai-providers.md](ai-providers.md).
