"""Turning sources into retrievable chunks.

Each kind of source is split differently on purpose: a document by size, a
conversation by who said what, a recording by time. Every chunk keeps the
metadata its citation will need.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from app.services.transcription.base import Segment


@dataclass(slots=True)
class Chunk:
    content: str
    index: int
    metadata: dict = field(default_factory=dict)


_PARAGRAPH = re.compile(r"\n\s*\n")


def chunk_document(text: str, chunk_size: int = 1200, overlap: int = 200) -> list[Chunk]:
    """Splits on paragraphs, then lines, never mid-sentence where avoidable."""
    normalised = (text or "").replace("\r\n", "\n").strip()
    if not normalised:
        return []
    if len(normalised) <= chunk_size:
        return [Chunk(content=normalised, index=0)]

    blocks = _blocks(normalised, chunk_size)
    chunks: list[str] = []
    current = ""

    for block in blocks:
        if current and len(current) + len(block) + 2 > chunk_size:
            chunks.append(current.strip())
            current = _tail(current, overlap)
        current = f"{current}\n\n{block}" if current else block

    if current.strip():
        chunks.append(current.strip())

    return [Chunk(content=content, index=index) for index, content in enumerate(chunks)]


def _blocks(text: str, limit: int) -> list[str]:
    blocks: list[str] = []
    for paragraph in _PARAGRAPH.split(text):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(paragraph) <= limit:
            blocks.append(paragraph)
            continue
        for line in paragraph.split("\n"):
            line = line.strip()
            if not line:
                continue
            if len(line) <= limit:
                blocks.append(line)
            else:
                # No natural boundary left in this line.
                blocks.extend(line[at : at + limit] for at in range(0, len(line), limit))
    return blocks


def _tail(text: str, overlap: int) -> str:
    """The last WHOLE lines of a chunk, up to `overlap` characters.

    Whole lines only: half a sentence carried into the next chunk is a
    fragment the model can misread, and wastes the space meant to keep
    context.
    """
    if overlap <= 0:
        return ""

    kept: list[str] = []
    length = 0
    for line in reversed(text.split("\n")):
        cost = len(line) + (1 if kept else 0)
        if length + cost > overlap:
            break
        kept.insert(0, line)
        length += cost
    return "\n".join(kept).strip()


@dataclass(slots=True)
class MessageInput:
    external_id: str | None
    sender: str
    text: str
    timestamp: datetime
    reply_to_text: str | None = None


def chunk_messages(messages: list[MessageInput], window: int = 6) -> list[Chunk]:
    """Groups a conversation into small windows.

    One message per chunk loses the thread ("Thursday works for me" means
    nothing alone); the whole day in one chunk buries it. A short window of
    consecutive messages keeps who said what, and when, retrievable.
    """
    chunks: list[Chunk] = []

    for index, start in enumerate(range(0, len(messages), window)):
        group = messages[start : start + window]
        if not group:
            continue

        lines = []
        for message in group:
            stamp = message.timestamp.strftime("%Y-%m-%d %H:%M")
            prefix = f"[{stamp}] {message.sender}:"
            if message.reply_to_text:
                quoted = message.reply_to_text[:120]
                lines.append(f"{prefix} (replying to: {quoted}) {message.text}")
            else:
                lines.append(f"{prefix} {message.text}")

        chunks.append(
            Chunk(
                content="\n".join(lines),
                index=index,
                metadata={
                    "message_ids": [message.external_id for message in group if message.external_id],
                    "senders": sorted({message.sender for message in group}),
                    "started_at": group[0].timestamp.isoformat(),
                    "ended_at": group[-1].timestamp.isoformat(),
                },
            )
        )
    return chunks


def format_timestamp(seconds: float) -> str:
    """0 -> "00:00:00", 2061 -> "00:34:21"."""
    total = int(max(seconds, 0))
    return f"{total // 3600:02d}:{(total % 3600) // 60:02d}:{total % 60:02d}"


def chunk_transcript(segments: list[Segment], chunk_size: int = 1200) -> list[Chunk]:
    """Timestamp-aware chunks, so an answer can cite the minute it came from."""
    if not segments:
        return []

    chunks: list[Chunk] = []
    current: list[Segment] = []
    length = 0

    def flush() -> None:
        nonlocal current, length
        if not current:
            return
        start, end = current[0].start, current[-1].end
        body = "\n".join(
            f"{format_timestamp(segment.start)} {segment.speaker + ': ' if segment.speaker else ''}{segment.text}"
            for segment in current
        )
        chunks.append(
            Chunk(
                content=f"{format_timestamp(start)} - {format_timestamp(end)}\n\n{body}",
                index=len(chunks),
                metadata={
                    "start_time": start,
                    "end_time": end,
                    "timestamp": format_timestamp(start),
                    "speakers": sorted({segment.speaker for segment in current if segment.speaker}),
                },
            )
        )
        current, length = [], 0

    for segment in segments:
        addition = len(segment.text) + 20
        if current and length + addition > chunk_size:
            flush()
        current.append(segment)
        length += addition

    flush()
    return chunks
