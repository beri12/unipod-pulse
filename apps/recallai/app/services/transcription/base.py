"""Transcription providers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass(slots=True)
class Segment:
    start: float
    end: float
    text: str
    speaker: str | None = None


@dataclass(slots=True)
class Transcript:
    text: str
    segments: list[Segment] = field(default_factory=list)
    duration: float | None = None
    language: str | None = None


@runtime_checkable
class TranscriptionProvider(Protocol):
    name: str

    async def transcribe(self, path: str) -> Transcript: ...
