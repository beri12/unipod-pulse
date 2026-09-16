# AI providers

Everything above the provider layer depends only on three interfaces —
`LlmProvider`, `EmbeddingProvider`, `TranscriptionProvider` — so adding a
provider means adding one file and one branch in `createAiBundle`.

## `openai` (production)

Works against **any OpenAI-compatible endpoint**: OpenAI itself, Azure OpenAI
gateways, Groq, Together, vLLM, LM Studio, or Ollama's `/v1` shim. Only
`OPENAI_BASE_URL` changes.

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-…
OPENAI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
TRANSCRIPTION_MODEL=whisper-1
```

Notes:

- Embeddings are batched (up to 96 inputs, ~100k tokens per request) and
  retried with exponential backoff. Order is preserved, so `result[i]` always
  matches `texts[i]`.
- The returned width is validated against `EMBEDDING_DIMENSIONS` on every batch,
  because a silent mismatch would store vectors the index cannot use.
- Transcription streams from a temporary file rather than holding large media
  twice in memory, and requests segment-level timestamps.
- Whisper does not diarise, so the speaker is left `null` rather than being
  labelled "Speaker 1" — an invented name in a citation is a small lie that
  looks like data.

## `local` (development, CI, offline demos)

```env
AI_PROVIDER=local
```

Needs no key and no network. It exists so the whole product — ingestion,
retrieval, answering, summaries, catch-up — can run and be tested anywhere.

**It is not a language model, and does not pretend to be one.**

| Capability | How it works | Honest limitation |
|---|---|---|
| Embeddings | Hashed bag-of-n-grams random projection, L2 normalised | Measures weighted lexical overlap. Real retrieval signal, but it will not connect a question to a passage that shares no words with it. |
| Answers | **Extractive**: selects and quotes sentences from retrieved sources | Cannot rephrase or synthesise across sources. Output reads as quotations, not prose. |
| Summaries | Cue-based extraction of decisions, actions, deadlines, open questions | Misses anything phrased without a recognisable cue. |
| Catch-up | Rule-based importance plus extractive per-item summaries | Importance is a heuristic, not judgement. |
| Speech-to-text | **Unavailable** — throws | Import an existing transcript instead. |

Because it only ever copies sentences out of retrieved sources, it **cannot
hallucinate**. That makes it a good substrate for testing the grounding
guarantees, and a poor substitute for a real model in front of users.

It is deliberately conservative about answering: a *statement* (not another
question in the archive) must cover at least half the question's meaning-bearing
words, rising to three quarters when the question contains a substantial word
the retrieved content has never used.

## Adding a provider

1. Implement the interfaces in `packages/ai/src/interfaces.ts`.
2. Add a branch to `createAiBundle` in `packages/ai/src/factory.ts`.
3. Add the provider name to the `AI_PROVIDER` enum in
   `packages/config/src/env.ts`.

If a provider can produce structured output without a prompt round trip, also
implement `StructuredProvider` and `LlmService` will prefer it. Nothing else in
the codebase changes.

## Which to use

| Situation | Provider |
|---|---|
| Production | `openai` (or a compatible endpoint) |
| CI and unit tests | `local` — deterministic, no key, no network |
| Offline demo | `local`, with a transcript imported rather than transcribed |
| Community data that must not leave your infrastructure | `openai` pointed at self-hosted inference via `OPENAI_BASE_URL` |
