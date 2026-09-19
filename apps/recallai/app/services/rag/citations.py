"""Citations, built by the backend from retrieved rows.

A model may name which chunks it used, never what those chunks are. Every id
it returns is checked against what retrieval actually produced, and the
human-readable citation is assembled here from the database record. That is
what makes a fabricated source impossible rather than merely discouraged.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.logging import get_logger
from app.db.repositories.chunks import RetrievedChunk

logger = get_logger(__name__)

#: How many sources a chat reply shows before it becomes unreadable.
MAX_CITATIONS = 3


@dataclass(slots=True)
class Citation:
    type: str
    title: str
    label: str
    source_id: str
    chunk_id: str
    relevance: float
    date: str | None = None
    url: str | None = None
    timestamp: str | None = None
    page: int | None = None
    sender: str | None = None

    def as_dict(self) -> dict:
        return {
            key: value
            for key, value in {
                "type": self.type,
                "title": self.title,
                "label": self.label,
                "source_id": self.source_id,
                "chunk_id": self.chunk_id,
                "relevance": round(self.relevance, 4),
                "date": self.date,
                "url": self.url,
                "timestamp": self.timestamp,
                "page": self.page,
                "sender": self.sender,
            }.items()
            if value is not None
        }


def build_citations(
    retrieved: list[RetrievedChunk],
    cited_chunk_ids: list[str],
    limit: int = MAX_CITATIONS,
) -> list[Citation]:
    """Turns the model's claimed chunk ids into citations it cannot fake.

    Ids that were never retrieved are dropped. If nothing survives, the
    highest-scoring retrieved chunks are cited instead: the answer was built
    from that context, so the reader still gets a real place to check.
    """
    by_id = {chunk.chunk_id: chunk for chunk in retrieved}

    kept: list[RetrievedChunk] = []
    invented: list[str] = []
    for chunk_id in cited_chunk_ids:
        chunk = by_id.get(str(chunk_id))
        if chunk is None:
            invented.append(str(chunk_id))
        elif chunk not in kept:
            kept.append(chunk)

    if invented:
        logger.warning(
            "llm_cited_unknown_chunks", count=len(invented), ids=invented[:5]
        )

    if not kept:
        kept = sorted(retrieved, key=lambda chunk: chunk.score, reverse=True)[:limit]

    return [_to_citation(chunk) for chunk in kept[:limit]]


def _to_citation(chunk: RetrievedChunk) -> Citation:
    meta = chunk.chunk_metadata or {}
    source_meta = chunk.source_metadata or {}
    date = (chunk.occurred_at or "")[:10] or None

    if chunk.source_type == "MESSAGE":
        sender = _first_sender(meta)
        label = " — ".join(part for part in [sender, chunk.source_title, date] if part)
        return Citation(
            type="message",
            title=chunk.source_title,
            label=label,
            source_id=chunk.source_id,
            chunk_id=chunk.chunk_id,
            relevance=chunk.score,
            date=date,
            url=chunk.source_url,
            sender=sender,
        )

    if chunk.source_type in {"AUDIO", "MEETING", "TRANSCRIPT"}:
        timestamp = meta.get("timestamp")
        label = " — ".join(part for part in [chunk.source_title, timestamp or date] if part)
        return Citation(
            type="meeting",
            title=chunk.source_title,
            label=label,
            source_id=chunk.source_id,
            chunk_id=chunk.chunk_id,
            relevance=chunk.score,
            date=date,
            url=chunk.source_url,
            timestamp=timestamp,
        )

    page = meta.get("page") or source_meta.get("page")
    filename = source_meta.get("filename") or chunk.source_title
    label = f"{filename} — page {page}" if page else filename
    return Citation(
        type="document",
        title=chunk.source_title,
        label=label,
        source_id=chunk.source_id,
        chunk_id=chunk.chunk_id,
        relevance=chunk.score,
        date=date,
        url=chunk.source_url,
        page=int(page) if page else None,
    )


def _first_sender(meta: dict) -> str | None:
    senders = meta.get("senders") or []
    return str(senders[0]) if senders else None


def format_for_chat(answer: str, citations: list[Citation]) -> str:
    """The WhatsApp-shaped reply: the answer, then where it came from."""
    if not citations:
        return answer
    lines = "\n".join(f"• {citation.label}" for citation in citations)
    return f"{answer}\n\nSources:\n{lines}"
