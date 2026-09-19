# RecallAI

**Never lose your conversation.**

An AI memory layer for a group. It collects what the group already said —
chat messages, meeting recordings, transcripts, documents — and answers
questions about it in natural language, with the sources that support the
answer.

```
member > When was the deployment moved to?

RecallAI > The deployment was moved to Thursday.

           Sources:
           • Alice — WhatsApp message — 2026-09-18
           • Weekly Team Meeting — 00:34:21
```

## Why

A large group produces more messages than anyone can read. People miss
decisions, ask questions that were answered last month, and cannot rewatch an
hour-long call to find one sentence. RecallAI makes all of it searchable and
answers from it.

Two rules make it trustworthy:

1. **It never invents.** Answers come only from the group's own knowledge. If
   the knowledge does not contain the answer, it says so.
2. **A group never sees another group's data.** Every retrieval is scoped by
   `group_id`, in the SQL itself.

---

## Architecture

```
  WhatsApp user
        │
        ▼
  Meta WhatsApp Cloud API
        │
        ▼
  FastAPI  ──────────────► Redis ──► Worker (transcription, embedding)
        │                                    │
        ▼                                    ▼
  RAG pipeline ────────────► PostgreSQL + pgvector
        │                    (chunks, embeddings, sources)
        ▼
  LLM (Ollama / OpenAI)
        │
        ▼
  Answer + sources ──► WhatsApp
```

The question path:

```
question → language detection → embedding → hybrid search (vector + full-text,
scoped to the group) → context → LLM → grounded answer → citations from the
retrieved rows
```

## Requirements

- Docker and Docker Compose
- Meta WhatsApp Cloud API credentials (only for the WhatsApp channel)

Nothing else. The default providers are offline, so it runs with no API key
and no model server.

## Install

```bash
cd apps/recallai
cp .env.example .env
docker compose up --build
docker compose exec api alembic upgrade head
docker compose exec api python -m scripts.seed
```

Then open http://localhost:8000/docs.

The seed prints a `group_id`. Ask it something:

```bash
curl -s localhost:8000/api/ask -H 'content-type: application/json' \
  -d '{"group_id":"<group_id>","question":"When is the deployment?"}' | jq
```

```json
{
  "answer": "Let's move the deployment to Thursday.",
  "language": "en",
  "confidence": "supported",
  "sources": [
    {
      "type": "message",
      "label": "Alice — WhatsApp message — 2026-09-18",
      "chunk_id": "…",
      "relevance": 0.71
    }
  ]
}
```

Ask the same thing in French and the answer comes back in French.

## Providers

Nothing is hard-coded to a vendor. Each is an interface with a factory behind
an environment variable.

| Role | `fake` (default) | Ollama | OpenAI |
|---|---|---|---|
| `LLM_PROVIDER` | quotes retrieved context | `qwen2.5`, `llama3` … | `gpt-4o-mini` … |
| `EMBEDDING_PROVIDER` | hashing vectoriser | `nomic-embed-text` | `text-embedding-3-small` |
| `TRANSCRIPTION_PROVIDER` | reads text "recordings" | `whisper_local` (faster-whisper) | Whisper API |

**`fake` is for development and tests**, not production: it answers by
quoting the best-matching retrieved sentence rather than writing prose. It
exists so the whole system — ingestion, retrieval, citation, refusal — is
runnable and testable with no keys, no GPU and no network.

### Local models with Ollama

```bash
docker compose --profile local up --build
docker compose exec ollama ollama pull qwen2.5
docker compose exec ollama ollama pull nomic-embed-text
```

```env
LLM_PROVIDER=ollama
EMBEDDING_PROVIDER=ollama
EMBEDDING_DIMENSIONS=768    # must match the model's real width
```

> Changing `EMBEDDING_DIMENSIONS` changes a database column. It needs a new
> migration and every chunk re-embedded.

## WhatsApp setup

1. developers.facebook.com → create an app → add the **WhatsApp** product.
2. Copy the access token and Phone Number ID into `.env`.
3. Expose the API publicly (`ngrok http 8000` during development).
4. In Meta → WhatsApp → Configuration set:
   - **Callback URL**: `https://your-host/api/webhooks/whatsapp`
   - **Verify token**: the same value as `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to **messages**
5. Set `WHATSAPP_APP_SECRET`. Without it inbound webhooks are not
   authenticated.

A message ending in `?`, starting with `@RecallAI`, or using `/search …` is
answered. Everything else is stored as knowledge without a reply — the bot
must not answer every message in a busy group.

Commands: `/help`, `/about`, `/search <query>`, `/sources`, `/status`.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/api/health` | Readiness — 503 when a dependency is down |
| `POST` | `/api/ask` | Ask the group's memory |
| `POST` | `/api/search` | Retrieval only, no model |
| `POST` | `/api/knowledge/messages` | Import chat messages |
| `POST` | `/api/knowledge/documents` | Upload PDF / DOCX / TXT / MD |
| `POST` | `/api/knowledge/audio` | Upload a recording to transcribe |
| `POST` | `/api/knowledge/transcripts` | Import a transcript directly |
| `GET` | `/api/groups` | List groups |
| `GET` | `/api/groups/{id}` | One group |
| `GET` | `/api/groups/{id}/sources` | Everything the group knows |
| `GET` | `/api/groups/{id}/messages` | Recent messages |
| `GET` | `/api/groups/{id}/meetings` | Recordings and transcripts |
| `GET`/`POST` | `/api/webhooks/whatsapp` | Meta verification and events |

Full schema at `/docs`, `/redoc`, `/openapi.json`.

Errors are always the same shape:

```json
{ "error": { "code": "GROUP_NOT_FOUND", "message": "Unknown group" } }
```

## Database

PostgreSQL with pgvector. 14 tables; the ones that matter for retrieval are
`sources` (what a citation points at) and `knowledge_chunks` (content +
embedding + `group_id`).

```bash
docker compose exec api alembic upgrade head            # apply
docker compose exec api alembic revision --autogenerate -m "add x"
docker compose exec api alembic downgrade -1            # roll back
```

Indexes: HNSW on the embedding (cosine), GIN on `to_tsvector(content)` for the
keyword half of hybrid search, plus `group_id`, `timestamp`, `source_id`,
`sender_id` and `external_message_id`.

## Testing

```bash
make test           # in the container
make test-local     # on the host, after pip install -r requirements-dev.txt
```

112 tests run with no database, no network and no API key — Claude, Whisper
and pgvector are all faked. They cover language detection, chunking (document,
conversation, timestamped transcript), citation building, WhatsApp parsing and
signatures, the RAG pipeline, group isolation, and the HTTP API.

Tests needing a real database are marked `integration` and skip themselves:

```bash
docker compose up -d postgres
DATABASE_URL=postgresql+psycopg://recallai:recallai@localhost:5432/recallai \
  .venv/bin/python -m pytest -m integration
```

## Commands

```bash
make up            # build and start
make up-local      # ... with Ollama
make down          # stop
make logs          # follow the API
make logs-worker   # follow the worker
make migrate       # alembic upgrade head
make seed          # load the demo group
make test          # run the suite
make pull-models   # download the Ollama models
```

## Security

- Group isolation is enforced in SQL, not in application code, and tested.
- Webhook signatures are verified against the raw request body.
- The verification handshake uses a constant-time comparison.
- Uploads are validated by type and size; stored filenames are generated, so
  an uploaded name can never steer a path.
- Secrets are redacted by the logger even if one is passed by mistake.
- Debug endpoints are off unless `ENABLE_DEBUG_ENDPOINTS=true`, and never
  mount in production.
- Every response carries a request id for tracing.

## Production notes

- Set `APP_ENV=production` — logs become JSON and stack traces stop being
  returned.
- Set `WHATSAPP_APP_SECRET`, or anyone who finds the URL can post events.
- Put the API behind TLS; Meta only calls HTTPS callbacks.
- Run at least one `worker`; audio transcription belongs there.
- Back up the `postgres_data` and `uploads` volumes — they are the memory.
- `GET /api/health` is the readiness probe; it fails when Postgres, Redis or
  a configured Ollama is unreachable.
