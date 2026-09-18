# Learned answers — the bot answers repeat questions

The problem this solves: in a community group the same questions come back every
week, and an admin answers them by hand every time.

So the bot watches:

```
member  > what are the opening hours?
admin   > We open 9h to 19h, Monday to Friday.      ← the bot learns this pair

  ... two weeks later, a different member, different words, different language ...

member  > @UniPodPulseBot chhal mn sa3a katbdaw?
bot     > We open 9h to 19h, Monday to Friday.      ← answered automatically
```

## How it understands different wording

When someone asks something, Claude receives the new question and the list of
questions the admins have already answered, and decides whether it is **the same
question** — across languages (English, French, Arabic, Darija), paraphrases,
typos and slang.

**The bot never writes the answer itself.** It repeats the admin's answer word
for word. Claude only decides *which* stored answer applies. So the bot cannot
invent facts about your community — the worst it can do is stay silent.

It is also told that answering wrongly is worse than not answering. These are
kept apart, for example:

| | |
|---|---|
| "what time do you open?" vs "à quelle heure vous ouvrez ?" | **same** → answered |
| "what time do you open?" vs "what time do you close?" | **different** → silent |
| "how much is a desk?" vs "how much is a meeting room?" | **different** → silent |

## Setup

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

That is the only required setting. Everything else has a default.

Without the key the bot still **learns** (so nothing is lost), it just does not
answer questions automatically yet.

## How it learns

**1. Automatically, from admins.** When a **group admin replies** to a member's
message, and that message looks like a question, the pair is stored. Nothing to
type — admins just answer as usual.

Only admins teach the bot. A regular member's guess is never learned.

**2. By hand:**

```
!learn what is the wifi password? | The wifi password is unipod2026.
```

## Managing what it knows

| Command | Who | What |
|---|---|---|
| `!faq` | anyone | Show the answers learned in this chat |
| `!learn question \| answer` | admins | Teach an answer directly |
| `!forget 1` | admins | Remove one (the number comes from `!faq`) |

Answers are stored **per chat**: one group's opening hours are not another
group's. A member writing to the bot privately gets the answers from that same
chat id.

## When the bot speaks

Unchanged from before — in a group it only answers when addressed (a
`!command`, a `/command`, or an @mention). It never jumps into a conversation
between members, even if it knows the answer.

In a private chat it answers any question.

## Tuning

| Setting | Default | What it does |
|---|---|---|
| `FAQ_MIN_CONFIDENCE` | `0.75` | How sure Claude must be. Raise it if the bot answers when it should not; lower it if it stays silent too often. |
| `FAQ_AUTO_LEARN` | `true` | Set `false` to only accept `!learn`. |
| `FAQ_EFFORT` | `low` | How hard Claude thinks. `medium`/`high` cost more per question. |
| `FAQ_MODEL` | `claude-opus-5` | The model used for matching. |
| `FAQ_MAX_ENTRIES` | `300` | Most stored answers sent in one matching call. |

## Where answers are stored

A JSON file, `./data/faq.json` by default (`FAQ_STORE_PATH`). It survives
restarts, is easy to read, back up, or edit by hand.

```json
[
  {
    "id": "8924b60d-...",
    "question": "what are the opening hours?",
    "answer": "We open 9h to 19h, Monday to Friday.",
    "chatId": "-100777",
    "answeredByName": "Youssef",
    "useCount": 3
  }
]
```

A file is the right size for a community FAQ (hundreds of entries). If it grows
into thousands, move it to the Postgres in `docker-compose.yml` — the image is
already `pgvector`, so questions can then be embedded and retrieved by vector
search, with Claude still making the final decision. `FaqStoreService` is the
only file that would change.

## Cost

One Claude call per question asked — not per message. The bot calls Claude only
when the text looks like a question, is addressed to it, and something has been
learned in that chat. Greetings, commands and chatter cost nothing.

## Testing it without an API key

```bash
npm run test       # learning rules, storage, the question detector
npm run test:e2e   # the whole flow: admin answers → member asks again → bot replies
```

The e2e suite replaces Claude with a stub, so the plumbing is proven without
spending anything. What a stub cannot check is Claude's judgement about two
questions meaning the same thing — that needs a real key and real questions.

Try the commands against a running server:

```bash
./scripts/fake-message.sh "!learn what are the opening hours? | We open 9h to 19h."
./scripts/fake-message.sh "!faq"
```
