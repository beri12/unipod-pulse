"""Getting knowledge in."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, File, Form, UploadFile

from app.api.deps import IngestionDep, SessionDep, SettingsDep
from app.core.errors import NotFound, ValidationFailed
from app.db.models import SourceType
from app.db.repositories.groups import GroupRepository
from app.schemas import IngestMessagesRequest, IngestResponse, IngestTranscriptRequest
from app.services.chunking.chunker import MessageInput
from app.services.documents.parsers import UnsupportedDocument
from app.services.transcription.base import Segment, Transcript

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])

AUDIO_SUFFIXES = {".mp3", ".wav", ".m4a", ".ogg", ".oga", ".opus", ".webm", ".mp4", ".flac", ".txt"}


async def _require_group(session, group_id: uuid.UUID) -> None:
    if await GroupRepository(session).get(group_id) is None:
        raise NotFound("Unknown group", code="GROUP_NOT_FOUND")


@router.post("/messages", response_model=IngestResponse, summary="Import chat messages")
async def ingest_messages(
    request: IngestMessagesRequest, ingestion: IngestionDep, session: SessionDep
) -> IngestResponse:
    await _require_group(session, request.group_id)

    result = await ingestion.ingest_messages(
        group_id=request.group_id,
        messages=[
            MessageInput(
                external_id=message.external_id,
                sender=message.sender,
                text=message.text,
                timestamp=message.timestamp,
                reply_to_text=message.reply_to_text,
            )
            for message in request.messages
        ],
    )
    await session.commit()
    return IngestResponse(**result.__dict__)


@router.post("/documents", response_model=IngestResponse, summary="Upload a PDF, DOCX, TXT or MD")
async def ingest_document(
    ingestion: IngestionDep,
    session: SessionDep,
    settings: SettingsDep,
    group_id: uuid.UUID = Form(...),
    title: str | None = Form(None),
    file: UploadFile = File(...),
) -> IngestResponse:
    await _require_group(session, group_id)
    data = await _read_upload(file, settings.max_upload_mb)

    try:
        result = await ingestion.ingest_document(
            group_id=group_id,
            filename=file.filename or "document",
            data=data,
            mime_type=file.content_type,
            title=title,
        )
    except UnsupportedDocument as error:
        raise ValidationFailed(str(error), code="UNSUPPORTED_DOCUMENT") from error

    await session.commit()
    return IngestResponse(**result.__dict__)


@router.post("/audio", response_model=IngestResponse, summary="Upload a recording to transcribe")
async def ingest_audio(
    ingestion: IngestionDep,
    session: SessionDep,
    settings: SettingsDep,
    group_id: uuid.UUID = Form(...),
    title: str | None = Form(None),
    file: UploadFile = File(...),
) -> IngestResponse:
    await _require_group(session, group_id)

    filename = file.filename or "recording"
    suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in AUDIO_SUFFIXES:
        raise ValidationFailed(
            f"Unsupported audio format '{suffix or filename}'. "
            f"Supported: {', '.join(sorted(AUDIO_SUFFIXES))}",
            code="UNSUPPORTED_AUDIO",
        )

    data = await _read_upload(file, settings.max_upload_mb)
    result = await ingestion.ingest_audio(group_id=group_id, filename=filename, data=data, title=title)
    await session.commit()
    return IngestResponse(**result.__dict__)


@router.post("/transcripts", response_model=IngestResponse, summary="Import a transcript directly")
async def ingest_transcript(
    request: IngestTranscriptRequest, ingestion: IngestionDep, session: SessionDep
) -> IngestResponse:
    await _require_group(session, request.group_id)

    if not request.text and not request.segments:
        raise ValidationFailed("Provide text or segments", code="EMPTY_TRANSCRIPT")

    segments = [
        Segment(start=segment.start, end=segment.end, text=segment.text, speaker=segment.speaker)
        for segment in request.segments
    ]
    transcript = Transcript(
        text=request.text or "\n".join(segment.text for segment in segments),
        segments=segments,
        duration=max((segment.end for segment in segments), default=None),
    )

    result = await ingestion.ingest_transcript(
        group_id=request.group_id,
        title=request.title,
        transcript=transcript,
        occurred_at=request.occurred_at,
        source_type=SourceType.TRANSCRIPT,
    )
    await session.commit()
    return IngestResponse(**result.__dict__)


async def _read_upload(file: UploadFile, max_mb: int) -> bytes:
    data = await file.read()
    if not data:
        raise ValidationFailed("The uploaded file is empty", code="EMPTY_FILE")
    if len(data) > max_mb * 1024 * 1024:
        raise ValidationFailed(
            f"File is larger than the {max_mb} MB limit", code="FILE_TOO_LARGE"
        )
    return data
