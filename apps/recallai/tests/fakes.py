"""Test doubles: no network, no database, no model server."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.db.repositories.chunks import RetrievedChunk
from app.services.embeddings.fake import FakeEmbeddingProvider
from app.services.llm.base import ContextChunk, LLMAnswer


@dataclass
class StoredChunk:
    group_id: uuid.UUID
    chunk_id: str
    source_id: str
    content: str
    source_type: str = "MESSAGE"
    source_title: str = "WhatsApp message"
    occurred_at: str | None = None
    chunk_metadata: dict = field(default_factory=dict)
    source_metadata: dict = field(default_factory=dict)


class InMemoryChunkRepository:
    """The same contract as the Postgres repository, scored in Python.

    Mirrors production's hybrid scoring — cosine similarity plus keyword
    overlap — so retrieval behaviour can be tested without pgvector.
    """

    def __init__(self, chunks: list[StoredChunk] | None = None) -> None:
        self.chunks = chunks or []
        self.embedder = FakeEmbeddingProvider(64)
        self.calls: list[dict] = []

    def add(self, chunk: StoredChunk) -> None:
        self.chunks.append(chunk)

    async def search(
        self,
        *,
        group_id: uuid.UUID,
        embedding: list[float],
        question: str,
        limit: int,
        candidates: int,
    ) -> list[RetrievedChunk]:
        self.calls.append({"group_id": group_id, "question": question})

        wanted = {word for word in question.lower().split() if len(word) > 2}
        results: list[RetrievedChunk] = []

        for chunk in self.chunks:
            # The isolation rule, enforced the same way the SQL enforces it.
            if chunk.group_id != group_id:
                continue

            vector = self.embedder.embed_sync(chunk.content)
            question_vector = self.embedder.embed_sync(question)
            vector_score = sum(a * b for a, b in zip(vector, question_vector))

            content_words = {word for word in chunk.content.lower().split() if len(word) > 2}
            keyword_score = len(wanted & content_words) / max(len(wanted), 1)

            score = 0.7 * vector_score + 0.3 * keyword_score
            if score <= 0:
                continue

            results.append(
                RetrievedChunk(
                    chunk_id=chunk.chunk_id,
                    source_id=chunk.source_id,
                    content=chunk.content,
                    score=score,
                    vector_score=vector_score,
                    keyword_score=keyword_score,
                    source_type=chunk.source_type,
                    source_title=chunk.source_title,
                    occurred_at=chunk.occurred_at,
                    chunk_metadata=chunk.chunk_metadata,
                    source_metadata=chunk.source_metadata,
                )
            )

        results.sort(key=lambda chunk: chunk.score, reverse=True)
        return results[:limit]


class ScriptedLLM:
    """Returns whatever the test tells it to."""

    name = "scripted"
    model = "scripted-1"

    def __init__(self, answer: LLMAnswer | None = None) -> None:
        self.answer = answer or LLMAnswer(answer=None, confidence="unsupported")
        self.seen: list[list[ContextChunk]] = []
        self.prompts: list[str] = []

    async def generate(self, *, system_prompt: str, user_prompt: str, context: list[ContextChunk]):
        self.seen.append(context)
        self.prompts.append(user_prompt)
        return self.answer
