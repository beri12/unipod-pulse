"""Whisper running locally through faster-whisper."""

from __future__ import annotations

import asyncio

from app.services.transcription.base import Segment, Transcript


class LocalWhisperProvider:
    name = "whisper_local"

    def __init__(self, model_size: str = "base", compute_type: str = "int8") -> None:
        self.model_size = model_size
        self.compute_type = compute_type
        self._model = None

    def _load(self):
        if self._model is None:
            # Imported here so the package is only needed when this provider is
            # actually selected — it pulls in a large ML runtime.
            from faster_whisper import WhisperModel

            self._model = WhisperModel(self.model_size, compute_type=self.compute_type)
        return self._model

    async def transcribe(self, path: str) -> Transcript:
        # Whisper is CPU/GPU-bound and blocking; keep the event loop free.
        return await asyncio.to_thread(self._transcribe_sync, path)

    def _transcribe_sync(self, path: str) -> Transcript:
        model = self._load()
        segments, info = model.transcribe(path, vad_filter=True)

        collected = [
            Segment(start=float(segment.start), end=float(segment.end), text=segment.text.strip())
            for segment in segments
        ]
        return Transcript(
            text="\n".join(segment.text for segment in collected),
            segments=collected,
            duration=float(getattr(info, "duration", 0.0)) or None,
            language=getattr(info, "language", None),
        )
