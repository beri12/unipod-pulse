"""Whisper through the OpenAI transcription API."""

from __future__ import annotations

from pathlib import Path

import httpx

from app.services.transcription.base import Segment, Transcript


class OpenAIWhisperProvider:
    name = "openai"

    def __init__(
        self, api_key: str, model: str, base_url: str, timeout: float = 600.0
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def transcribe(self, path: str) -> Transcript:
        file_path = Path(path)

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self.base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                files={"file": (file_path.name, file_path.read_bytes())},
                data={
                    "model": self.model,
                    # verbose_json is what carries the segment timestamps that
                    # make "00:34:21" citable.
                    "response_format": "verbose_json",
                },
            )
            response.raise_for_status()
            payload = response.json()

        segments = [
            Segment(
                start=float(segment.get("start", 0.0)),
                end=float(segment.get("end", 0.0)),
                text=(segment.get("text") or "").strip(),
            )
            for segment in payload.get("segments", [])
            if (segment.get("text") or "").strip()
        ]
        return Transcript(
            text=(payload.get("text") or "").strip(),
            segments=segments,
            duration=payload.get("duration"),
            language=payload.get("language"),
        )
