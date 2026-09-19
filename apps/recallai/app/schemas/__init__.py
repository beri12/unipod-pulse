from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SourceOut(BaseModel):
    type: str = Field(examples=["message"])
    title: str = Field(examples=["WhatsApp message"])
    label: str = Field(description="Ready to print", examples=["Alice — WhatsApp message — 2026-09-18"])
    source_id: str
    chunk_id: str
    relevance: float
    date: str | None = None
    url: str | None = None
    timestamp: str | None = Field(default=None, examples=["00:34:21"])
    page: int | None = None
    sender: str | None = None


class AskRequest(BaseModel):
    group_id: uuid.UUID
    question: str = Field(min_length=1, max_length=2000, examples=["When was the deployment moved?"])
    user_id: uuid.UUID | None = None
    use_conversation_memory: bool = True


class AskResponse(BaseModel):
    answer: str
    language: str = Field(examples=["en"])
    confidence: str = Field(examples=["supported"])
    sources: list[SourceOut] = []
    model: str = ""
    took_ms: int = 0


class SearchRequest(BaseModel):
    group_id: uuid.UUID
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=8, ge=1, le=50)


class SearchHit(BaseModel):
    chunk_id: str
    source_id: str
    source_type: str
    title: str
    content: str
    score: float
    vector_score: float
    keyword_score: float


class SearchResponse(BaseModel):
    hits: list[SearchHit]


class MessageIn(BaseModel):
    external_id: str | None = None
    sender: str = Field(max_length=200)
    text: str = Field(min_length=1)
    timestamp: datetime
    reply_to_text: str | None = None


class IngestMessagesRequest(BaseModel):
    group_id: uuid.UUID
    messages: list[MessageIn] = Field(min_length=1, max_length=500)


class TranscriptSegmentIn(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str
    speaker: str | None = None


class IngestTranscriptRequest(BaseModel):
    group_id: uuid.UUID
    title: str = Field(min_length=1, max_length=400)
    text: str | None = None
    segments: list[TranscriptSegmentIn] = []
    occurred_at: datetime | None = None


class IngestResponse(BaseModel):
    source_ids: list[uuid.UUID]
    chunks: int
    skipped: int = 0
    status: str = "COMPLETED"
    detail: str | None = None


class GroupOut(BaseModel):
    id: uuid.UUID
    name: str
    platform: str
    external_group_id: str


class HealthResponse(BaseModel):
    status: str
    checks: dict[str, str]
