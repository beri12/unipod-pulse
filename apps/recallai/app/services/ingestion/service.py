"""Putting knowledge in: messages, documents, audio and transcripts.

Every path ends the same way — a Source row that a citation can point at, and
chunks with embeddings that retrieval can find.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.logging import get_logger
from app.db.models import (
    AudioRecording,
    Document,
    KnowledgeChunk,
    Message,
    ProcessingStatus,
    Source,
    SourceType,
    TranscriptSegment,
)
from app.db.repositories.groups import MessageRepository
from app.services.chunking.chunker import (
    Chunk,
    MessageInput,
    chunk_document,
    chunk_messages,
    chunk_transcript,
)
from app.services.documents.parsers import parse_document
from app.services.embeddings.base import EmbeddingProvider
from app.services.transcription.base import Segment, Transcript, TranscriptionProvider

logger = get_logger(__name__)

#: Chunks embedded per request to the provider.
EMBED_BATCH = 32


@dataclass(slots=True)
class IngestResult:
    source_ids: list[uuid.UUID]
    chunks: int
    skipped: int = 0
    status: str = "COMPLETED"
    detail: str | None = None


class IngestionService:
    def __init__(
        self,
        *,
        session: AsyncSession,
        settings: Settings,
        embeddings: EmbeddingProvider,
        transcription: TranscriptionProvider | None = None,
        storage=None,
    ) -> None:
        self._session = session
        self._settings = settings
        self._embeddings = embeddings
        self._transcription = transcription
        self._storage = storage

    # ── Messages ──────────────────────────────────────────────────────────────

    async def ingest_messages(
        self, *, group_id: uuid.UUID, messages: list[MessageInput]
    ) -> IngestResult:
        if not messages:
            return IngestResult(source_ids=[], chunks=0)

        messages = sorted(messages, key=lambda message: message.timestamp)

        # Re-delivered webhooks are normal; storing a message twice would
        # double its weight in retrieval.
        known = await MessageRepository(self._session).existing_external_ids(
            group_id, [message.external_id for message in messages if message.external_id]
        )
        fresh = [
            message
            for message in messages
            if not message.external_id or message.external_id not in known
        ]
        skipped = len(messages) - len(fresh)
        if not fresh:
            return IngestResult(source_ids=[], chunks=0, skipped=skipped)

        source_ids: list[uuid.UUID] = []
        total_chunks = 0

        for chunk in chunk_messages(fresh):
            started_at = datetime.fromisoformat(chunk.metadata["started_at"])
            senders = chunk.metadata.get("senders") or []

            source = Source(
                group_id=group_id,
                type=SourceType.MESSAGE,
                title="WhatsApp message" if len(senders) <= 1 else "WhatsApp conversation",
                occurred_at=started_at,
                source_metadata={
                    "senders": senders,
                    "message_ids": chunk.metadata.get("message_ids", []),
                },
            )
            self._session.add(source)
            await self._session.flush()
            source_ids.append(source.id)

            total_chunks += await self._store_chunks(group_id, source, [chunk])

        for message in fresh:
            self._session.add(
                Message(
                    group_id=group_id,
                    external_message_id=message.external_id,
                    sender_name=message.sender,
                    text=message.text,
                    timestamp=message.timestamp,
                    message_metadata={},
                )
            )

        await self._session.flush()
        logger.info(
            "messages_ingested", group_id=str(group_id), stored=len(fresh), skipped=skipped
        )
        return IngestResult(source_ids=source_ids, chunks=total_chunks, skipped=skipped)

    # ── Documents ─────────────────────────────────────────────────────────────

    async def ingest_document(
        self,
        *,
        group_id: uuid.UUID,
        filename: str,
        data: bytes,
        mime_type: str | None = None,
        title: str | None = None,
    ) -> IngestResult:
        parsed = parse_document(data, filename, mime_type)
        if not parsed.text.strip():
            return IngestResult(source_ids=[], chunks=0, status="FAILED", detail="No text found")

        source = Source(
            group_id=group_id,
            type=SourceType.DOCUMENT,
            title=title or filename,
            occurred_at=datetime.now(tz=timezone.utc),
            source_metadata={"filename": filename, **parsed.metadata},
        )
        self._session.add(source)
        await self._session.flush()

        storage_path = None
        if self._storage:
            storage_path = self._storage.save(str(group_id), filename, data)

        self._session.add(
            Document(
                source_id=source.id,
                filename=filename,
                mime_type=mime_type or "application/octet-stream",
                storage_path=storage_path,
                text=parsed.text,
                page_count=parsed.metadata.get("page_count"),
                document_metadata=parsed.metadata,
            )
        )

        # Chunk page by page so a citation can name the page it came from.
        chunks: list[Chunk] = []
        for page in parsed.pages or []:
            for chunk in chunk_document(
                page.text, self._settings.chunk_size, self._settings.chunk_overlap
            ):
                chunk.index = len(chunks)
                chunk.metadata = {**chunk.metadata, "page": page.number}
                chunks.append(chunk)

        stored = await self._store_chunks(group_id, source, chunks)
        await self._session.flush()
        logger.info("document_ingested", group_id=str(group_id), filename=filename, chunks=stored)
        return IngestResult(source_ids=[source.id], chunks=stored)

    # ── Transcripts and audio ────────────────────────────────────────────────

    async def ingest_transcript(
        self,
        *,
        group_id: uuid.UUID,
        title: str,
        transcript: Transcript,
        occurred_at: datetime | None = None,
        source_type: SourceType = SourceType.MEETING,
        filename: str | None = None,
        storage_path: str | None = None,
    ) -> IngestResult:
        source = Source(
            group_id=group_id,
            type=source_type,
            title=title,
            occurred_at=occurred_at or datetime.now(tz=timezone.utc),
            source_metadata={
                "filename": filename,
                "duration": transcript.duration,
                "language": transcript.language,
            },
        )
        self._session.add(source)
        await self._session.flush()

        recording = AudioRecording(
            source_id=source.id,
            filename=filename or f"{title}.txt",
            duration_seconds=transcript.duration,
            storage_path=storage_path,
            transcript=transcript.text,
        )
        self._session.add(recording)
        await self._session.flush()

        for segment in transcript.segments:
            self._session.add(
                TranscriptSegment(
                    audio_recording_id=recording.id,
                    speaker=segment.speaker,
                    start_time=segment.start,
                    end_time=segment.end,
                    text=segment.text,
                )
            )

        chunks = (
            chunk_transcript(transcript.segments, self._settings.chunk_size)
            if transcript.segments
            else chunk_document(
                transcript.text, self._settings.chunk_size, self._settings.chunk_overlap
            )
        )
        stored = await self._store_chunks(group_id, source, chunks)
        await self._session.flush()
        logger.info("transcript_ingested", group_id=str(group_id), title=title, chunks=stored)
        return IngestResult(source_ids=[source.id], chunks=stored)

    async def ingest_audio(
        self,
        *,
        group_id: uuid.UUID,
        filename: str,
        data: bytes,
        title: str | None = None,
    ) -> IngestResult:
        if self._transcription is None:
            raise RuntimeError("No transcription provider configured")

        storage_path = (
            self._storage.save(str(group_id), filename, data) if self._storage else None
        )
        if storage_path is None:
            raise RuntimeError("Audio ingestion requires a storage provider")

        try:
            transcript = await self._transcription.transcribe(storage_path)
        except Exception as error:  # noqa: BLE001 - recorded, then re-raised as a result
            logger.error("transcription_failed", filename=filename, error=str(error))
            source = Source(
                group_id=group_id,
                type=SourceType.AUDIO,
                title=title or filename,
                status=ProcessingStatus.FAILED,
                error=str(error)[:500],
                source_metadata={"filename": filename},
            )
            self._session.add(source)
            await self._session.flush()
            return IngestResult(
                source_ids=[source.id], chunks=0, status="FAILED", detail=str(error)
            )

        return await self.ingest_transcript(
            group_id=group_id,
            title=title or filename,
            transcript=transcript,
            source_type=SourceType.AUDIO,
            filename=filename,
            storage_path=storage_path,
        )

    # ── Shared ────────────────────────────────────────────────────────────────

    async def _store_chunks(
        self, group_id: uuid.UUID, source: Source, chunks: list[Chunk]
    ) -> int:
        if not chunks:
            return 0

        stored = 0
        for start in range(0, len(chunks), EMBED_BATCH):
            batch = chunks[start : start + EMBED_BATCH]
            embeddings = await self._embeddings.embed_batch([chunk.content for chunk in batch])

            for chunk, embedding in zip(batch, embeddings, strict=True):
                self._session.add(
                    KnowledgeChunk(
                        group_id=group_id,
                        source_id=source.id,
                        content=chunk.content,
                        embedding=embedding,
                        chunk_index=chunk.index,
                        chunk_metadata=chunk.metadata,
                    )
                )
                stored += 1

        return stored
