"""Offline transcription, for development and tests.

A file that decodes as text is taken at its word, which is what makes the
whole audio pipeline runnable — and testable — without Whisper or a GPU: drop
a .txt "recording" in and everything downstream behaves as it will in
production. Anything else yields a short fixed transcript.

Lines shaped like "00:12:34 Speaker: text" keep their timestamp and speaker,
so timestamped citations are exercised too.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.services.transcription.base import Segment, Transcript

_TIMED_LINE = re.compile(
    r"^\[?(?P<h>\d{1,2}):(?P<m>\d{2})(?::(?P<s>\d{2}))?\]?\s*"
    r"(?:(?P<speaker>[^:]{1,40}):)?\s*(?P<text>.+)$"
)
_SECONDS_PER_LINE = 15.0


class FakeTranscriptionProvider:
    name = "fake"

    async def transcribe(self, path: str) -> Transcript:
        try:
            raw = Path(path).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            return Transcript(
                text="This recording could not be transcribed offline.",
                segments=[],
                duration=None,
            )

        segments: list[Segment] = []
        cursor = 0.0

        for line in (line.strip() for line in raw.splitlines()):
            if not line:
                continue

            match = _TIMED_LINE.match(line)
            if match and match.group("s") is not None:
                hours, minutes, seconds = (
                    int(match.group("h")),
                    int(match.group("m")),
                    int(match.group("s")),
                )
                start = hours * 3600 + minutes * 60 + seconds
                text = match.group("text").strip()
                speaker = (match.group("speaker") or "").strip() or None
            else:
                start = cursor
                speaker, _, spoken = line.partition(":")
                if spoken.strip() and len(speaker) <= 40:
                    text, speaker = spoken.strip(), speaker.strip()
                else:
                    text, speaker = line, None

            if segments:
                segments[-1].end = max(segments[-1].end, start)
            segments.append(Segment(start=start, end=start + _SECONDS_PER_LINE, text=text, speaker=speaker))
            cursor = start + _SECONDS_PER_LINE

        return Transcript(
            text="\n".join(segment.text for segment in segments),
            segments=segments,
            duration=segments[-1].end if segments else 0.0,
        )
