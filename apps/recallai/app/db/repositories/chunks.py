"""Retrieval over knowledge chunks.

Every method takes `group_id` as a required argument, and every statement
filters on it. That is the security boundary of the whole product: one
group's question must never reach another group's knowledge.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

#: How the two retrieval signals are weighted when they are combined.
VECTOR_WEIGHT = 0.7
KEYWORD_WEIGHT = 0.3


@dataclass(slots=True)
class RetrievedChunk:
    chunk_id: str
    source_id: str
    content: str
    score: float
    source_type: str
    source_title: str
    source_url: str | None = None
    occurred_at: str | None = None
    chunk_metadata: dict = field(default_factory=dict)
    source_metadata: dict = field(default_factory=dict)
    vector_score: float = 0.0
    keyword_score: float = 0.0


@runtime_checkable
class ChunkRepository(Protocol):
    async def search(
        self,
        *,
        group_id: uuid.UUID,
        embedding: list[float],
        question: str,
        limit: int,
        candidates: int,
    ) -> list[RetrievedChunk]: ...


#: Hybrid retrieval: vector similarity for meaning, full-text for the exact
#: names, dates and identifiers that embeddings blur.
_SEARCH_SQL = text(
    """
WITH vector_hits AS (
    SELECT c.id,
           1 - (c.embedding <=> CAST(:embedding AS vector)) AS vector_score
    FROM knowledge_chunks c
    WHERE c.group_id = :group_id
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> CAST(:embedding AS vector)
    LIMIT :candidates
),
keyword_hits AS (
    SELECT c.id,
           ts_rank(to_tsvector('simple', c.content),
                   plainto_tsquery('simple', :question)) AS keyword_score
    FROM knowledge_chunks c
    WHERE c.group_id = :group_id
      AND :question <> ''
      AND to_tsvector('simple', c.content) @@ plainto_tsquery('simple', :question)
    ORDER BY keyword_score DESC
    LIMIT :candidates
),
merged AS (
    SELECT id FROM vector_hits
    UNION
    SELECT id FROM keyword_hits
)
SELECT c.id             AS chunk_id,
       c.source_id      AS source_id,
       c.content        AS content,
       c.metadata       AS chunk_metadata,
       COALESCE(v.vector_score, 0)  AS vector_score,
       COALESCE(k.keyword_score, 0) AS keyword_score,
       s.type           AS source_type,
       s.title          AS source_title,
       s.external_url   AS source_url,
       s.occurred_at    AS occurred_at,
       s.metadata       AS source_metadata
FROM merged m
JOIN knowledge_chunks c  ON c.id = m.id
JOIN sources s           ON s.id = c.source_id
LEFT JOIN vector_hits v  ON v.id = m.id
LEFT JOIN keyword_hits k ON k.id = m.id
WHERE c.group_id = :group_id
  AND s.group_id = :group_id
ORDER BY (:vector_weight * COALESCE(v.vector_score, 0)
        + :keyword_weight * COALESCE(k.keyword_score, 0)) DESC
LIMIT :limit
"""
)


class PostgresChunkRepository:
    """pgvector-backed hybrid retrieval, always scoped to one group."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def search(
        self,
        *,
        group_id: uuid.UUID,
        embedding: list[float],
        question: str,
        limit: int,
        candidates: int,
    ) -> list[RetrievedChunk]:
        if group_id is None:
            # Defence in depth: an unscoped search would leak across groups.
            raise ValueError("group_id is required for retrieval")

        rows = await self._session.execute(
            _SEARCH_SQL,
            {
                "group_id": group_id,
                "embedding": _vector_literal(embedding),
                "question": question or "",
                "limit": limit,
                "candidates": candidates,
                "vector_weight": VECTOR_WEIGHT,
                "keyword_weight": KEYWORD_WEIGHT,
            },
        )

        results: list[RetrievedChunk] = []
        for row in rows.mappings():
            vector_score = float(row["vector_score"] or 0.0)
            keyword_score = float(row["keyword_score"] or 0.0)
            source_type = row["source_type"]
            results.append(
                RetrievedChunk(
                    chunk_id=str(row["chunk_id"]),
                    source_id=str(row["source_id"]),
                    content=row["content"],
                    score=VECTOR_WEIGHT * vector_score + KEYWORD_WEIGHT * keyword_score,
                    vector_score=vector_score,
                    keyword_score=keyword_score,
                    source_type=getattr(source_type, "value", str(source_type)),
                    source_title=row["source_title"],
                    source_url=row["source_url"],
                    occurred_at=row["occurred_at"].isoformat() if row["occurred_at"] else None,
                    chunk_metadata=row["chunk_metadata"] or {},
                    source_metadata=row["source_metadata"] or {},
                )
            )
        return results


def _vector_literal(embedding: list[float]) -> str:
    """pgvector's text input format."""
    return "[" + ",".join(f"{value:.8f}" for value in embedding) + "]"
