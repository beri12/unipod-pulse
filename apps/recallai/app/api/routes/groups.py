"""Reading a group's knowledge back."""

from __future__ import annotations

import uuid

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import SessionDep
from app.core.errors import NotFound
from app.db.models import AudioRecording, Source, SourceType
from app.db.repositories.groups import GroupRepository, MessageRepository
from app.schemas import GroupOut

router = APIRouter(prefix="/api/groups", tags=["groups"])


@router.get("", response_model=list[GroupOut], summary="List groups")
async def list_groups(session: SessionDep) -> list[GroupOut]:
    groups = await GroupRepository(session).list_all()
    return [GroupOut.model_validate(group, from_attributes=True) for group in groups]


@router.get("/{group_id}", response_model=GroupOut, summary="One group")
async def get_group(group_id: uuid.UUID, session: SessionDep) -> GroupOut:
    group = await GroupRepository(session).get(group_id)
    if group is None:
        raise NotFound("Unknown group", code="GROUP_NOT_FOUND")
    return GroupOut.model_validate(group, from_attributes=True)


@router.get("/{group_id}/sources", summary="Everything the group knows")
async def list_sources(group_id: uuid.UUID, session: SessionDep, limit: int = 100) -> list[dict]:
    rows = await session.execute(
        select(Source)
        .where(Source.group_id == group_id)
        .order_by(Source.created_at.desc())
        .limit(limit)
    )
    return [
        {
            "id": str(source.id),
            "type": source.type.value,
            "title": source.title,
            "occurred_at": source.occurred_at.isoformat() if source.occurred_at else None,
            "status": source.status.value,
            "metadata": source.source_metadata,
        }
        for source in rows.scalars()
    ]


@router.get("/{group_id}/messages", summary="Recent messages")
async def list_messages(group_id: uuid.UUID, session: SessionDep, limit: int = 100) -> list[dict]:
    messages = await MessageRepository(session).list_for_group(group_id, limit)
    return [
        {
            "id": str(message.id),
            "sender": message.sender_name,
            "text": message.text,
            "timestamp": message.timestamp.isoformat(),
            "external_message_id": message.external_message_id,
        }
        for message in messages
    ]


@router.get("/{group_id}/meetings", summary="Recordings and transcripts")
async def list_meetings(group_id: uuid.UUID, session: SessionDep, limit: int = 50) -> list[dict]:
    rows = await session.execute(
        select(Source, AudioRecording)
        .join(AudioRecording, AudioRecording.source_id == Source.id, isouter=True)
        .where(
            Source.group_id == group_id,
            Source.type.in_([SourceType.AUDIO, SourceType.MEETING, SourceType.TRANSCRIPT]),
        )
        .order_by(Source.created_at.desc())
        .limit(limit)
    )
    return [
        {
            "source_id": str(source.id),
            "title": source.title,
            "type": source.type.value,
            "status": source.status.value,
            "occurred_at": source.occurred_at.isoformat() if source.occurred_at else None,
            "duration_seconds": recording.duration_seconds if recording else None,
            "filename": recording.filename if recording else None,
        }
        for source, recording in rows.all()
    ]
