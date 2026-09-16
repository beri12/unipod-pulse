# Retrieval architecture

How a question becomes an answer, and why each step is the way it is.

## 1. Chunking

`packages/ai/src/chunking.ts`

Retrieval quality is decided here more than anywhere else. The chunker:

- **never splits a sentence.** Only a single sentence longer than the whole
  budget is hard-split, on a word boundary. A chunk that ends mid-clause
  retrieves badly and quotes worse.
- **overlaps neighbours by whole sentences.** A fact that straddles a boundary
  is retrievable from either side.
- **carries provenance.** Each chunk keeps the metadata of the segment it
  started in — page, section, timestamp, speaker — which is what a citation
  later shows. A chunk spanning two pages records both.
- **accepts forced boundaries.** Callers can require a break; meetings use this
  so a chunk stays inside one stretch of the recording.

Defaults are 600 target tokens with 80 tokens of overlap, configurable through
`CHUNK_TARGET_TOKENS` and `CHUNK_OVERLAP_TOKENS`. Token counts are estimated by
a heuristic rather than a real tokenizer: chunk sizes only need to be
approximately right, and a BPE tokenizer is megabytes of dependency plus a WASM
load on every worker boot.

### Meetings are chunked on time as well as tokens

A transcript chunk covers at most three minutes, and a pause longer than ninety
seconds ends it. Without this, a forty-five minute call becomes two or three
chunks and every citation points at the opening minute. With it, the decision
made at 32:15 is cited **at 32:15**.

Each meeting also indexes one extra chunk containing its decisions, action
items, deadlines and open questions — extracted by cue from the transcript and
**quoted verbatim**, never generated. That is what makes "what did we decide
about X" retrievable when the sentence recording the decision shares no words
with the question.

## 2. Contextual headers

`packages/ingest/src/context-header.ts`

Each chunk is stored with a header naming where it came from:

```
[Hackathon Guidelines · Judging criteria]
Projects are scored out of 100 points across four categories…
```

A passage lifted out of the middle of a file otherwise carries no clue about
what it belongs to — yet that is exactly the signal both retrievers need. The
header is part of the stored text, so it is indexed and embedded; it is stripped
again before anything is shown as a quote, because quoting it back would put
words in the source's mouth.

## 3. Storage

`prisma/schema.prisma`, `packages/database/src/`

Chunks live in three tables (`document_chunks`, `meeting_chunks`,
`message_chunks`), each with a `vector(1536)` column. Indexes added by
`prisma/migrations/*_search_indexes`:

- **HNSW, cosine** on every embedding column — approximate nearest neighbour.
- **GIN on `to_tsvector('english', content)`** — full-text search.
- **Trigram** on source titles and normalised questions — admin substring search.

These are expression and operator-class indexes that Prisma's schema language
cannot express, so they live in a hand-written migration. **Keep that migration
when editing the schema.**

### Changing the embedding dimension

`EMBEDDING_DIMENSIONS` must match the `vector(N)` columns. Changing the model to
one with a different width means a migration that alters all four columns and
re-embeds everything. The embedding service validates the width on every batch
and fails loudly rather than storing a vector the index cannot use.

## 4. Retrieval

`apps/api/src/rag/rag.service.ts`, `packages/database/src/retrieval.ts`

The question is embedded, then two retrievers run **concurrently**:

- **Vector search** — one LIMIT-ed subquery per chunk table so each can use its
  own HNSW index, unioned and re-sorted. The embedding is bound as a parameter
  (`$n::vector`); it is never interpolated into SQL.
- **Full-text search** — `websearch_to_tsquery`, which safely accepts free-form
  input including quoted phrases and `-exclusions`. `ts_rank_cd` is squashed to
  [0,1] with `rank / (rank + 1)` so it can be blended with cosine similarity.

Both take the demo filter and any date range, so demo and real content can never
appear in the same result set.

## 5. Hybrid ranking

`apps/api/src/rag/ranking.service.ts`

Semantic similarity alone is not trustworthy. It returns chunks that are *about*
deadlines when asked for *the* deadline, and it has no notion of which of two
contradicting sources is current. Four signals are blended, each normalised to
[0,1]:

| Signal | Default weight | Why |
|---|---|---|
| Semantic | 0.60 | Meaning, including paraphrase |
| Keyword | 0.25 | Exact terms, names and numbers that embeddings blur |
| Recency | 0.10 | Community facts go stale fast (30-day half-life) |
| Title match | 0.05 | Question/source-title overlap |

Weights are configuration (`RAG_WEIGHT_*`), not constants. **No weight is
attached to the kind of source.** A chat message that states the answer outranks
a PDF that does not.

A chunk is kept if it clears the absolute floor **or** sits within 45% of the
best match, because the useful score range depends on the embedding model. If
nothing clears either bar, the single best candidate is still returned — saying
"no confirmed answer" after looking beats never looking.

## 6. Grounding

`packages/ai/src/prompts.ts`, `packages/ai/src/services/llm.service.ts`,
`apps/api/src/chat/chat.service.ts`

The prompt states the rules, but the rules are **enforced in code**, because a
prompt is a request and not a guarantee:

1. The model receives numbered context and must cite with `[n]`.
2. Markers are parsed out of its own text and resolved against what was
   actually retrieved. **Anything that does not resolve is deleted** — a model
   that invents `[9]` for a four-item context produces no phantom source.
3. A substantive answer with no usable citation is retried once with an explicit
   correction; if it still cites nothing, it is replaced by the "no confirmed
   answer" response.
4. Citations are written from the chunks the answer used, each linked to a real
   `Source` row, with a quote **copied verbatim** out of the retrieved chunk.
   Nothing on a citation card is model-generated.
5. Markers are renumbered to match the citation cards the reader sees, so `[2]`
   in the text is card 2 on screen.

The offline provider reaches the same guarantee differently: it is extractive,
so every sentence it outputs is already a verbatim copy of a retrieved source.
It additionally requires a *statement* — not another question in the archive —
to cover at least half the question's meaning-bearing words, rising to three
quarters when the question contains a substantial word the retrieved content has
never used. That rule is what makes it decline "Is there a travel stipend for
demo day?" instead of answering from a source that only knows when demo day is.

## 7. Conflicts

When two sources state different dates or figures for the same thing, both are
shown, the more recent is identified as current, and the reader is told to
verify if the difference matters. Dates are compared **by meaning**, not by
text, so "September 17" and "September 17, 2026" are not reported as a
disagreement.

## 8. When there is no answer

The exact sentence is a shared constant (`NO_ANSWER_SENTENCE`), asserted in
tests. The question is then recorded as an information gap, grouped with
paraphrases in two passes: an exact match on an order-independent normalised key
(stopwords dropped, words stemmed, sorted), then a vector nearest-neighbour
lookup above 0.82 cosine, so *"when does registration end"* joins *"what's the
registration deadline"*.

## Measuring it

`pnpm rag:eval` measures retrieval relevance, source correctness, answer
groundedness and refusal correctness over a fixed dataset. Groundedness is
checked by verifying that every quoted span exists verbatim in a retrieved
chunk, so a fluent answer quoting something nobody said fails. See the README
for the current measured numbers and what they do and do not claim.
