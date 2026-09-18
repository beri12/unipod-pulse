# UniPod Pulse

A community bot that keeps a busy group informed: it answers questions from
everything the community already knows — admin answers, call recordings,
imported notes — and tells people what they missed.

```
  WhatsApp (official API)  ─┐
  WhatsApp (group bot)      ├─>  one knowledge base  ─>  answers, with sources
  Telegram                  │                        ─>  "what did I miss?"
  voice notes & recordings ─┘                        ─>  questions nobody answered
```

## Run it

```bash
cp .env.example .env     # fill in the keys you have
docker compose up --build
```

That is the whole setup. Everything below is optional detail.

Without Docker:

```bash
cd apps/api && npm install && npm run build && node dist/main.js
```

## The keys

| Key | Needed for | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Answering questions, catch-up | The bot still learns and imports, but does not answer |
| `TELEGRAM_BOT_TOKEN` | Telegram (groups work officially) | Telegram is off |
| `OPENAI_API_KEY` | Voice notes and call recordings | Audio is ignored |
| `KNOWLEDGE_INGEST_TOKEN` | Importing transcripts over HTTP | The import endpoints are open to anyone who can reach the server |
| `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp private chats (official) | WhatsApp Cloud API is off |
| `WHATSAPP_GROUP_BOT_ENABLED=true` | WhatsApp groups (unofficial) | WhatsApp groups are off |

Nothing is required to boot — the bot starts with no keys at all and says in
its logs what each missing key would enable.

## Documentation

| | |
|---|---|
| [KNOWLEDGE.md](KNOWLEDGE.md) | How it learns, answers, tracks unanswered questions, and catches people up |
| [TELEGRAM.md](TELEGRAM.md) | Telegram setup — the easiest channel, groups officially supported |
| [WHATSAPP.md](WHATSAPP.md) | WhatsApp setup, official API and the group bot |

## The stack

| | |
|---|---|
| API | NestJS 12 on Node 22, ESM |
| Answering | Claude (`@anthropic-ai/sdk`), structured outputs |
| Speech to text | OpenAI transcription — Claude has no audio endpoint |
| WhatsApp groups | whatsapp-web.js, driving WhatsApp Web in Chromium |
| WhatsApp private | Meta's official Cloud API, webhook + signature check |
| Telegram | Bot API over plain `fetch`, long polling or webhook |
| Storage | JSON files (`./data`), Postgres with pgvector ready for when it grows |
| Tests | vitest — 152 unit, 50 e2e |

## Tests

```bash
cd apps/api
npm run test       # 152 tests
npm run test:e2e   # 50 tests
```

Both run with no API keys and no network: Claude and the transcription service
are stubbed, so the whole flow is exercised without spending anything.

```bash
# Or drive a running bot by hand:
./scripts/fake-message.sh "!help"
CHANNEL=telegram ./scripts/fake-message.sh "/catchup"
./scripts/import.sh call.txt --title "Weekly call 12 Sep"
```
