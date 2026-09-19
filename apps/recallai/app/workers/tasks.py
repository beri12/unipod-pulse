"""Jobs the worker runs.

Each job opens its own database session: it runs in a different process from
the request that queued it.
"""

from __future__ import annotations

import asyncio
import uuid

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.database import SessionLocal
from app.db.models import ProcessingStatus, Source
from app.services.embeddings.factory import build_embedding_provider
from app.services.ingestion.service import IngestionService
from app.services.storage.local import LocalStorageProvider
from app.services.transcription.factory import build_transcription_provider

logger = get_logger("recallai.worker")


def transcribe_audio_job(group_id: str, source_id: str, storage_path: str, title: str) -> dict:
    """PROCESS: transcribe a stored recording and ingest the transcript."""
    return asyncio.run(_transcribe_audio(group_id, source_id, storage_path, title))


async def _transcribe_audio(group_id: str, source_id: str, storage_path: str, title: str) -> dict:
    settings = get_settings()
    configure_logging(settings.log_level)
    transcription = build_transcription_provider(settings)

    async with SessionLocal() as session:
        source = await session.get(Source, uuid.UUID(source_id))
        if source is None:
            return {"status": "FAILED", "detail": "source not found"}

        source.status = ProcessingStatus.PROCESSING
        await session.commit()

        logger.info("transcription_started", source_id=source_id)
        try:
            transcript = await transcription.transcribe(storage_path)
        except Exception as error:  # noqa: BLE001 - recorded so it can be retried
            source.status = ProcessingStatus.FAILED
            source.error = str(error)[:500]
            await session.commit()
            logger.error("transcription_failed", source_id=source_id, error=str(error))
            return {"status": "FAILED", "detail": str(error)}

        ingestion = IngestionService(
            session=session,
            settings=settings,
            embeddings=build_embedding_provider(settings),
            transcription=transcription,
            storage=LocalStorageProvider(settings.storage_path),
        )
        result = await ingestion.ingest_transcript(
            group_id=uuid.UUID(group_id),
            title=title,
            transcript=transcript,
            filename=storage_path.rsplit("/", 1)[-1],
            storage_path=storage_path,
        )

        # The placeholder source is replaced by the ingested one.
        await session.delete(source)
        await session.commit()

        logger.info("transcription_completed", source_id=source_id, chunks=result.chunks)
        return {"status": "COMPLETED", "chunks": result.chunks}
