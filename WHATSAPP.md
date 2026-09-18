# WhatsApp bot — setup and testing

> For Telegram, see [TELEGRAM.md](TELEGRAM.md). All channels share one command
> layer, so a command written once works everywhere.

```
  WhatsApp Cloud API (official)  ─┐
   private chats only             │
  WhatsApp Baileys bot           ─┼─>  CommandRouterService  ─>  reply
   groups + private, unofficial   │
  Telegram (official)            ─┘
   groups + private
```

> **Important:** the official WhatsApp Cloud API **cannot read or write in
> groups**. Meta does not allow it. If you want the bot inside your WhatsApp
> groups, that is part 2 (Baileys) — not part 1.

---

## 0. Run it with no credentials at all

The app boots fine with nothing configured, which is the fastest way to see
the command layer working:

```bash
cd apps/api
npm install
npm run build
WHATSAPP_VERIFY_TOKEN=test-token node dist/main.js
```

In a second terminal, pretend to be Meta:

```bash
./scripts/fake-message.sh "!help"
```

```
you  > !help
bot  > Commands I understand:
       !about — What this bot is
       !echo — Repeat back what you wrote — useful while testing
       !help — List the available commands
       !ping — Check that the bot is alive
       !whoami — Show how the bot sees you
```

The script builds Meta's real webhook payload, POSTs it, and prints the reply.
You can change who is writing:

```bash
FROM=212611111111 NAME=Youssef ./scripts/fake-message.sh "!whoami"
PORT=3001 ./scripts/fake-message.sh "!echo hello"
```

Or do it by hand and read the log:

```bash
curl http://localhost:3000/bot/messages
```

No WhatsApp account needed. This is the loop to use while writing commands.

---

## 1. Official Cloud API (private chats)

### Get credentials

1. developers.facebook.com → create an app → type **Business**.
2. Add the **WhatsApp** product. You get a free test number.
3. Copy the **temporary access token** and the **Phone Number ID**.
4. Under "To", add your own number as a recipient and confirm the code
   WhatsApp sends you. Skip this and your messages go nowhere.

Copy `.env.example` to `.env` and fill in:

```bash
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_VERIFY_TOKEN=any-random-string-you-choose
WHATSAPP_APP_SECRET=            # optional, see "Signature" below
```

### Check sending works

```bash
curl -X POST "https://graph.facebook.com/v21.0/$WHATSAPP_PHONE_NUMBER_ID/messages" \
  -H "Authorization: Bearer $WHATSAPP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"212XXXXXXXXX",
       "type":"template","template":{"name":"hello_world","language":{"code":"en_US"}}}'
```

### Connect the webhook

Meta needs a public HTTPS URL, so tunnel your local server:

```bash
npm run start:dev          # terminal 1
ngrok http 3000            # terminal 2
```

In Meta → WhatsApp → Configuration → Edit:

- **Callback URL:** `https://YOUR-TUNNEL.ngrok-free.app/whatsapp/webhook`
- **Verify token:** the same `WHATSAPP_VERIFY_TOKEN` value
- Subscribe to the **messages** field.

Meta sends a `GET` with `hub.challenge`; the app echoes it back and the
subscription saves. You should see `Webhook verified by Meta` in the logs.

Now send `!help` from your phone to the test number. The bot replies.

### Signature

Set `WHATSAPP_APP_SECRET` (Meta → App settings → Basic) and the app rejects any
webhook not signed by Meta via `X-Hub-Signature-256`. Leave it empty during
local curl testing, set it in production.

### Two things that will bite you

- **The temporary token expires after 24 hours.** A sudden `401` while testing
  is almost always this. Create a System User token for anything lasting.
- **The 24-hour window.** Free-form text only reaches a user within 24h of
  their last message to you. Outside it, only approved templates work —
  use `CloudApiService.sendTemplate()`.

---

## 2. Group bot (Baileys) — this is the one for your groups

### How it works

It logs in as a **linked device** of a normal WhatsApp account, exactly like
WhatsApp Web. That is why it can see group messages when the official API
cannot.

**Read this before using it:** this is against WhatsApp's Terms of Service and
the number can be banned without warning. Use a **dedicated SIM**, never your
personal number, and do not build a paying product on it.

### Start it

```bash
# in .env
WHATSAPP_GROUP_BOT_ENABLED=true
```

```bash
npm run start:dev
```

A QR code prints in the terminal. On the bot's phone:
**WhatsApp → Settings → Linked devices → Link a device** → scan it.

The session is saved in `./wa-session` (gitignored). You scan **once** — do not
delete that folder or you will have to scan again.

Then add the bot's number to your group like a normal member and type `!ping`.

**If no QR appears:** after 30 seconds you get
`Still no QR code or connection after 30s`. Baileys needs a direct WebSocket to
`web.whatsapp.com`; a corporate proxy, a VPN or a locked-down container will
block it. Run it somewhere with normal outbound network access.

### Limit it to certain groups

By default the bot listens in every group it is added to. To restrict it:

1. Send `!ping` in the group, then `curl http://localhost:3000/bot/messages`
2. Copy the `chatId` (it ends in `@g.us`)
3. Put it in `.env`:

```bash
WHATSAPP_ALLOWED_GROUPS=120363000000000000@g.us,120363111111111111@g.us
```

### When the bot speaks in a group

Only when addressed — a `!command` or an **@mention**. It ignores ordinary
chatter, and stays silent on an unrecognised word after a mention (so
"@bot thanks!" does not produce an error message in the group).

This is deliberate. A bot that answers everything gets reported by members, and
reports are what get numbers banned.

---

## 3. Adding your own commands

Edit `src/bot/commands/builtin.commands.ts`:

```ts
{
  name: 'desk',
  description: 'Book a desk for today',
  aliases: ['bureau'],
  handler: async ({ args, message }) => {
    const desk = args[0];
    if (!desk) return 'Which desk? Example: !desk 12';
    return `Desk ${desk} booked for ${message.senderName ?? 'you'} ✅`;
  },
}
```

It immediately works on WhatsApp **and** Telegram, in private chats **and** in
groups, and appears in `!help`.

From another module you can also call `commandRouter.register({...})`.

The handler receives:

| field | meaning |
|---|---|
| `message.text` | full message text |
| `message.senderId` | phone number or JID of the writer |
| `message.senderName` | WhatsApp display name |
| `message.isGroup` | true in a group |
| `message.channel` | `'whatsapp-cloud'`, `'whatsapp-group'` or `'telegram'` |
| `args` | words after the command |
| `rest` | raw text after the command |

Return a string to reply, or `null` to stay silent.

---

## 4. Tests

```bash
cd apps/api
npm run test       # 25 tests: command routing, de-duplication, signature checking
npm run test:e2e   # 13 tests: the webhook over real HTTP, no WhatsApp account needed
```

The e2e suite posts Meta's real payload shape at the webhook, so you can develop
the whole flow without a phone.

Three levels, cheapest first:

| What | Command | Needs |
|---|---|---|
| Logic | `npm run test` | nothing |
| Whole HTTP flow | `npm run test:e2e` | nothing |
| By hand, live server | `./scripts/fake-message.sh "!ping"` | the API running |
| Real WhatsApp | send from your phone | credentials + tunnel (part 1) |

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/whatsapp/webhook` | Meta's verification handshake |
| `POST` | `/whatsapp/webhook` | Inbound messages from Meta |
| `GET` | `/bot/messages` | Recent traffic on every channel, for debugging |

`GET /bot/messages` is an unauthenticated debug view of recent message content.
Remove it or put it behind auth before going to production.

## Not included yet

Received messages are kept **in memory only** (the last 200, for the debug
endpoint) and are lost on restart. Persisting them to the project's Postgres
would need a Prisma schema and a `DATABASE_URL`, which do not exist in this repo
yet — adding them would have meant you could not run any of the above without a
database first. `MessageLogService` is the single place to change when you want
that.


---

## Answering questions automatically

Beyond commands, the bot can learn answers from group admins and reply to the
same question when it is asked again in different words — see
[LEARNED-ANSWERS.md](LEARNED-ANSWERS.md).
