"""Development-only inspection. Never mounted in production."""

from __future__ import annotations

import uuid

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import RAGDep, SessionDep
from app.db.models import KnowledgeChunk

router = APIRouter(prefix="/api/debug", tags=["debug"], include_in_schema=False)


@router.get("/retrieval/{group_id}")
async def debug_retrieval(group_id: uuid.UUID, query: str, rag: RAGDep) -> list[dict]:
    chunks = await rag._retrieve(group_id=group_id, question=query)
    return [
        {
            "chunk_id": chunk.chunk_id,
            "score": round(chunk.score, 4),
            "vector": round(chunk.vector_score, 4),
            "keyword": round(chunk.keyword_score, 4),
            "type": chunk.source_type,
            "title": chunk.source_title,
            "preview": chunk.content[:200],
        }
        for chunk in chunks
    ]


@router.get("/chunks/{group_id}")
async def debug_chunks(group_id: uuid.UUID, session: SessionDep, limit: int = 50) -> list[dict]:
    rows = await session.execute(
        select(KnowledgeChunk)
        .where(KnowledgeChunk.group_id == group_id)
        .order_by(KnowledgeChunk.created_at.desc())
        .limit(limit)
    )
    return [
        {
            "id": str(chunk.id),
            "source_id": str(chunk.source_id),
            "index": chunk.chunk_index,
            "metadata": chunk.chunk_metadata,
            "content": chunk.content[:300],
        }
        for chunk in rows.scalars()
    ]
