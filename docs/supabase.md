# Running on Supabase

Supabase is the least painful way to get the database this project needs,
because pgvector is already on the server. Nothing to compile.

That matters more than it sounds. The first migration runs
`CREATE EXTENSION IF NOT EXISTS "vector"`, and that statement only *enables* an
extension the PostgreSQL host already has installed. A stock PostgreSQL — a
Windows installer build, say — fails with:

```
ERROR: extension "vector" is not available
DETAIL: Could not open extension control file ".../vector.control"
```

which is not something a migration can fix. Supabase and the
`pgvector/pgvector` Docker image both ship it; most other setups mean building
it yourself.

## Setup

**1. Enable the extensions.** In the dashboard, **Database → Extensions**,
enable:

- `vector` — required; the embedding columns do not exist without it
- `pg_trgm` — the admin knowledge browser's substring search
- `unaccent` — accent-insensitive text search

The migration would enable them itself if the role were allowed to, but doing it
in the dashboard is one less permission to think about.

**2. Copy the connection strings.** Dashboard → **Connect**. You want two,
and they are not the same:

```bash
# Pooled, port 6543 — application traffic
DATABASE_URL="postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres"

# Direct session, port 5432 — migrations
DIRECT_DATABASE_URL="postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
```

Migrations need a real session: they create types and indexes and run in a
transaction that must outlive a single statement, which transaction-mode pooling
does not guarantee. `prisma.config.ts` reads `DIRECT_DATABASE_URL` first for
exactly this reason.

If either setting is awkward to get right, point both at the direct connection.
You lose pooling, which at community scale you will not notice.

**Percent-encode the password.** `@` → `%40`, `#` → `%23`, `/` → `%2F`. An
unencoded `@` makes the URL parse a different host, and the error you get back
will not mention the password at all.

**3. Migrate and seed.**

```bash
pnpm db:generate
pnpm db:deploy
pnpm db:seed     # optional demo community
```

**4. Redis is still yours to run.** Supabase does not provide it, and the worker
needs it for the job queues:

```bash
docker compose up -d redis
```

## What Supabase features this does and does not use

It uses Supabase as **plain PostgreSQL**. Not Supabase Auth, not Supabase
Storage, not the PostgREST data API, not row-level security.

That is deliberate, not an oversight. This app already has its own JWT auth,
its own storage abstraction and its own query layer, and all three are exercised
by the test suite. Swapping them for Supabase equivalents would mean rewriting
working, tested code to gain a dashboard.

The practical consequence: **anyone holding the database password has full
access to every table.** There is no row-level security standing behind the
API. Treat the connection string like the credential it is, keep it out of the
browser (it is only ever read server-side), and never put it in a
`NEXT_PUBLIC_*` variable.

## Recovering from a failed migration

If a migration fails partway — most often because `vector` was not enabled
first — Prisma records the failure and refuses to continue:

```
Error: P3009  migrate found failed migrations in the target database
```

Clear the record, then re-run:

```bash
pnpm exec prisma migrate resolve --rolled-back 20260916185810_init
pnpm db:deploy
```

`resolve` only updates Prisma's bookkeeping table. It does not fix whatever
caused the failure — enable the extension first, or the next attempt fails
identically.

## Verified, and not

The application code is database-agnostic: it connects through
`@prisma/adapter-pg` with a plain connection string, so any PostgreSQL that
speaks the wire protocol and has pgvector will work. The full suite — migrations,
retrieval, citations, the end-to-end tests — is verified against PostgreSQL 16
with pgvector 0.6.0.

The Supabase-specific instructions above (pooled vs direct ports, the extensions
panel) have **not** been run against a live Supabase project as part of this
repository's test suite. If something in step 2 does not match what your
dashboard shows, trust the dashboard.
