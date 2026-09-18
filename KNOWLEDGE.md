# The knowledge base — how the bot keeps the group informed

The problem: the group is too big to read. Messages scroll past, people miss
meetings and cannot rewatch the recordings, and the same questions get asked
again and again because the answer is buried in a chat from three weeks ago or
in a call nobody has time to re-listen to.

So the bot keeps everything in one place and answers from it.

```
  admin answers in the group  ─┐
  call transcripts imported    ├─>  one knowledge base  ─>  answers, with sources
  notes and documents          │
  the group's own messages    ─┘                        ─>  "what did I miss?"
                                                        ─>  questions nobody answered
```

## What it does

| | |
|---|---|
| **Answers repeat questions** | Someone asks something an admin already answered — in any language, any wording — and the bot replies with that answer. |
| **Answers from calls** | Import a call transcript once; the bot answers questions about what was decided. |
| **Says when it does not know** | It never guesses. It says so and records the question. |
| **Tracks the gaps** | Organisers see the unanswered questions, most-asked first, and can answer them in one command. |
| **Catches people up** | `!catchup` summarises what someone missed. |

## Setup

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
KNOWLEDGE_INGEST_TOKEN=any-random-string   # needed to import transcripts
```

Without the key the bot still **learns, archives and imports** — it just does
not answer questions yet, so nothing is lost while you set it up.

---

## 1. Learning from the group

When a **group admin replies** to a member's message, and that message looks
like a question, the pair is stored as the community's official answer.
Nothing to type — admins just answer as usual.

Only admins teach the bot. A member's guess is never learned.

## 2. Importing calls, notes and documents

```bash
./scripts/import.sh call-12-sep.txt --title "Weekly call 12 Sep" --date 2026-09-12
./scripts/import.sh rules.md --title "Group rules" --type note
```

The transcript is split into chunks on speaker turns (never mid-sentence), each
indexed with a one-line summary so the bot can find the right part later.

Re-importing the same title **replaces** the previous import, so fixing a
transcript is safe.

Types: `meeting` (default), `note`, `chat`, `qa`.

By default an import is community-wide — every chat can use it. Add
`--scope <chat id>` to limit it to one group.

Or POST it yourself:

```bash
curl -X POST http://localhost:3000/knowledge/documents \
  -H "Authorization: Bearer $KNOWLEDGE_INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Weekly call 12 Sep","content":"...","type":"meeting","date":"2026-09-12"}'
```

## 3. Answering

When someone asks a question, the bot gathers what it knows for that chat, lets
Claude read the relevant parts, and answers **in the asker's language**, with a
line saying where the answer came from:

```
member > @UniPodPulseBot chhal mn sa3a katbdaw?
bot    > We open 9h to 19h, Monday to Friday.

         📌 answered by Youssef
```

```
member > @UniPodPulseBot when is the weekly call now?
bot    > The weekly call moved to Thursday at 18h.

         📌 Weekly call 12 Sep, 2026-09-12
```

**The bot only uses the community's own sources.** It is told never to add
outside knowledge, and that answering wrongly is worse than not answering.

## 4. When it does not know

```
bot > I couldn't find a confirmed answer in the available community information.
      This question has been recorded so an organiser can fill the gap.
```

That question now sits in the backlog:

```
admin > !gaps
bot   > 2 open questions:

        1. is there parking nearby? (asked 4×)
        2. do you have a printer?

        Answer one with: !resolve 1 your answer

admin > !resolve 1 Yes, free parking behind the building.
bot   > Answered ✅ I will use this from now on.
```

From then on everyone who asks about parking gets that answer. **The questions
the group keeps asking become the FAQ automatically**, sorted by how much time
they are costing.

## 5. Catching up

```
member > !catchup
bot    > Here is what you missed in the last 24h:

         • The weekly call moved to Thursday at 18h
         • Amina asked about the room booking — Sara confirmed until 20h
         • Still open: nobody answered the printer question
```

`!catchup 6` for the last 6 hours. Up to 14 days.

---

## Commands

| Command | Who | What |
|---|---|---|
| `!ask <question>` | anyone | Ask explicitly |
| `!catchup [hours]` | anyone | What you missed |
| `!sources` | anyone | What the bot knows here |
| `!gaps` | admins | Questions nobody answered |
| `!resolve <n> <answer>` | admins | Answer one, and teach the bot |
| `!learn question \| answer` | admins | Teach directly |
| `!forget <n>` | admins | Remove something |

In a group the bot only replies when addressed (a command or an @mention). It
never jumps into a conversation between members, even when it knows the answer.
In a private chat it answers any question.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/knowledge/documents` | Import a transcript, note or document |
| `GET` | `/knowledge/entries` | Everything stored |
| `GET` | `/knowledge/gaps` | Open questions |

All three require `Authorization: Bearer $KNOWLEDGE_INGEST_TOKEN` when that is
set. **Set it** — without it, anyone who can reach the server can put words in
the bot's mouth.

## Tuning

| Setting | Default | What it does |
|---|---|---|
| `KNOWLEDGE_MIN_CONFIDENCE` | `0.7` | How well sources must answer before replying. Raise it if the bot answers when it should not. |
| `KNOWLEDGE_MAX_READ` | `8` | Sources read in full per answer. |
| `KNOWLEDGE_CHUNK_SIZE` | `1400` | Characters per transcript chunk. |
| `KNOWLEDGE_ARCHIVE_LIMIT` | `500` | Messages kept per chat for catch-up. |
| `KNOWLEDGE_EFFORT` | `low` | How hard Claude thinks. |
| `KNOWLEDGE_AUTO_LEARN` | `true` | Set `false` to only accept `!learn`. |

## Cost

Claude is called:

- **once per question asked** — only when the text looks like a question, the
  bot was addressed, and it has something to check against
- **once per `!catchup`**
- **once per chunk at import time** (to write its index line)

Greetings, commands and ordinary chatter cost nothing.

With a small knowledge base the bot reads everything in one call. Once it grows
past `KNOWLEDGE_MAX_READ` entries, it first picks what to read from the summary
lines, then reads only those — so cost stays flat as you import more calls.

## Where it is stored

Three JSON files in `KNOWLEDGE_DATA_DIR` (`./data`), written atomically:

| File | What |
|---|---|
| `knowledge.json` | Everything the bot knows |
| `gaps.json` | Unanswered questions |
| `archive.json` | Recent messages, for catch-up |

Easy to read, back up, or edit by hand. If it grows into thousands of entries,
move it to the Postgres in `docker-compose.yml` — the image is already
`pgvector`, so chunks can be retrieved by vector search with Claude still
making the final decision. `KnowledgeStoreService` is the only file that
changes.

## Testing it without an API key

```bash
npm run test       # 137 tests: chunking, storage, learning rules, retrieval
npm run test:e2e   # 42 tests: the whole flow over HTTP
```

The suites replace Claude with a stub, so everything but Claude's judgement is
proven without spending anything.

Against a running server:

```bash
./scripts/import.sh call.txt --title "Weekly call"
./scripts/fake-message.sh "!sources"
CHANNEL=telegram ./scripts/fake-message.sh "/catchup"
```
