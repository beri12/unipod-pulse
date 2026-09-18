# Telegram bot — setup and testing

Telegram is the easiest of the three channels: **groups are officially
supported**, so there is no unofficial library, no terms-of-service problem and
no risk of a banned number.

It shares the command layer with WhatsApp — write a command once in
`src/bot/commands/builtin.commands.ts` and it works on both.

---

## 1. Create the bot (2 minutes)

1. Open Telegram and write to **[@BotFather](https://t.me/BotFather)**
2. Send `/newbot`
3. Choose a name (e.g. `UniPod Pulse`) and a username ending in `bot`
   (e.g. `UniPodPulseBot`)
4. BotFather replies with a token like `8123456789:AAF...`

Put it in `.env`:

```bash
TELEGRAM_BOT_TOKEN=8123456789:AAF...
TELEGRAM_MODE=polling
```

## 2. Run it

```bash
cd apps/api
npm run start:dev
```

You should see:

```
[TelegramBotService] Telegram connected as @UniPodPulseBot
[TelegramBotService] Telegram long polling started
```

**That is all.** No tunnel, no ngrok, no public URL. Polling works from a
laptop, behind a firewall.

## 3. Test it

Open Telegram, search for your bot's username, press **Start**, and write:

| you write | bot answers |
|---|---|
| `/ping` | `pong ✅` |
| `/help` | the list of commands |
| `hello` / `salam` / `bonjour` | a welcome message |
| `/echo hello` | `hello` |

`/ping` and `!ping` both work — Telegram's `/` is converted to the shared
prefix automatically.

## 4. Add it to a group

1. Open your group → **Add member** → search your bot's username → add it
2. Write `/ping` in the group

### Make it see every message (optional)

By default Telegram's **privacy mode** means a bot in a group only receives:

- messages starting with `/`
- messages that @mention it
- replies to its own messages

That matches how this bot behaves anyway, so **leave it on**. Only if you want
the bot to read every message in the group:

@BotFather → `/mybots` → your bot → *Bot Settings* → *Group Privacy* → *Turn off*
(then remove the bot from the group and add it again).

### When the bot speaks in a group

Only when addressed — a `/command`, an @mention, or a reply to its own message.
It ignores ordinary chatter. In a group with several bots, `/ping@OtherBot` is
left to that other bot.

### Limit it to certain groups

```bash
# Send /ping in the group, then:
curl http://localhost:3000/bot/messages
# copy the chatId (group ids are negative, e.g. -1001234567890)

TELEGRAM_ALLOWED_CHATS=-1001234567890,-1009876543210
```

---

## Webhook mode (for a deployed server)

Polling is fine in production too, but if you prefer Telegram to push to you:

```bash
TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_SECRET=some-random-string
```

Register your public URL once:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://your-server.com/telegram/webhook",
       "secret_token":"some-random-string",
       "allowed_updates":["message"]}'
```

Telegram echoes that secret in the `X-Telegram-Bot-Api-Secret-Token` header, and
the app rejects any update without it. To go back to polling:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
```

> You cannot use polling and a webhook at the same time. Delete the webhook
> before switching back, or `getUpdates` will fail.

---

## Testing without a Telegram account

```bash
npm run test           # includes the Telegram message mapper
npm run test:e2e       # posts real Telegram update payloads at the webhook
```

Or against a running server:

```bash
CHANNEL=telegram ./scripts/fake-message.sh "/ping"
CHANNEL=telegram ./scripts/fake-message.sh "hello"
CHANNEL=telegram GROUP=1 ./scripts/fake-message.sh "/ping@UniPodPulseBot"
```

---

## WhatsApp vs Telegram

| | WhatsApp official | WhatsApp Baileys | Telegram |
|---|---|---|---|
| Private chats | ✅ | ✅ | ✅ |
| **Groups** | ❌ never | ⚠️ yes, unofficial | ✅ **yes, official** |
| Allowed | ✅ | ❌ ToS violation | ✅ |
| Ban risk | none | real | none |
| Setup | Meta app + tunnel | QR scan | one token |
| Public URL needed | yes | no | no (polling) |

**If you mainly want a group bot, Telegram is the better home for it.**

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/telegram/webhook` | Inbound updates (webhook mode only) |
| `GET` | `/bot/messages` | Recent traffic on every channel, for debugging |

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Could not reach Telegram: ... 401` | Wrong or revoked token. Check `@BotFather`. |
| Bot silent in a group | Privacy mode: use `/command` or @mention it. |
| `Conflict: terminated by other getUpdates` | Another copy of the bot is polling the same token, or a webhook is still registered. |
| Nothing happens in private chat | Press **Start** in the chat first. |

---

## Answering questions automatically

Beyond commands, the bot can learn answers from group admins and reply to the
same question when it is asked again in different words — see
[LEARNED-ANSWERS.md](LEARNED-ANSWERS.md).
