# n8n workflows

The bot works two ways, and they are interchangeable by design.

**Built into the API.** Set `TELEGRAM_BOT_TOKEN` and the API runs the bot
itself, by long polling. Nothing else to host, nothing public to expose. This is
the path to use if you just want it working.

**Through n8n.** Import `telegram-pulse.json`. n8n owns the Telegram connection
and calls the same two HTTP endpoints the built-in bot calls internally. Use
this when you want the workflow visible and editable without touching code.

Run one or the other, not both — two pollers on one bot token will fight over
updates, and Telegram will hand each update to whichever asked first.

## Setup

1. **Create the bot.** Talk to [@BotFather](https://t.me/BotFather): `/newbot`,
   then `/setprivacy` → **Disable**.

   That second step is not optional. With privacy mode on — the default — a bot
   in a group only receives messages that start with `/`. It would never see
   ordinary conversation, which is the entire point. After changing it, remove
   the bot from the group and add it again; the setting is applied when it
   joins.

2. **Set the secret.** In the API's `.env`:

   ```bash
   BOT_INGEST_SECRET=<48+ random characters>
   ```

   Without it, `/api/ingest/*` refuses every request rather than defaulting to
   open.

3. **Set n8n's environment** (Settings → Variables, or the host's env):

   | Variable | Value |
   | --- | --- |
   | `PULSE_API_URL` | `https://your-api-host` (no trailing slash) |
   | `PULSE_BOT_SECRET` | the same `BOT_INGEST_SECRET` |
   | `PULSE_BOT_USERNAME` | the bot's @username, without the `@` |

4. **Import the workflow**, add your Telegram credential to the two Telegram
   nodes (they carry a `REPLACE_WITH_YOUR_CREDENTIAL_ID` placeholder), and
   activate it.

## What the workflow does

```
Telegram Trigger → Normalise message → Store message → Addressed to the bot? → Ask Pulse → Reply in group
```

Every group message is stored. Only messages addressed to the bot get answered
— `/ask …`, an `@mention`, a reply to something the bot said, or any message in
a direct chat with it. A bot that replied to everything would be noise in
exactly the busy group this is meant to calm down.

Storing happens before answering, so an answer can never cite a message the
archive does not yet have.

## The endpoints

Both take `x-bot-secret` and are documented in Swagger at `/api/docs`.

`POST /api/ingest/message` — store captured messages. De-duplicates on
`(channel, externalId)`, so replaying a batch after a failure imports nothing
twice.

```json
{ "messages": [ {
  "externalId": "tg:-1001234:56", "channel": "Pulse Group",
  "authorName": "Amina", "content": "Rehearsal moved to Thursday 14:00.",
  "messageDate": "2026-09-17T09:00:00Z"
} ] }
```

`POST /api/ingest/ask` — ask a question. Returns `text` ready to post back, plus
`answered`, `confidence` and the `sources` behind it.

```json
{ "question": "When is the rehearsal?", "channel": "Pulse Group" }
```

When the knowledge base has no answer, `answered` is `false` and `sources` is
empty — the reply says it could not find a confirmed answer rather than
guessing. Post it as-is; that refusal is the feature.

## WhatsApp

There is deliberately no WhatsApp workflow here.

The WhatsApp Business Cloud API does not support groups: a business number
cannot join a group and receive what is said in it. So WhatsApp is handled by
exporting the chat (**Export chat → Without media**) and uploading the `.txt` in
the admin UI under **Messages → Import**, which runs the same tested parser the
rest of the ingestion uses — including skipping WhatsApp's own system lines.

Re-implementing that parser in a Code node would give two copies to keep in
step, and the one in n8n would be the untested one.
