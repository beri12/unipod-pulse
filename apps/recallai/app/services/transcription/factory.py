from __future__ import annotations

from functools import lru_cache

from app.core.config import Settings, get_settings
from app.services.transcription.base import TranscriptionProvider
from app.services.transcription.fake import FakeTranscriptionProvider
from app.services.transcription.openai_whisper import OpenAIWhisperProvider
from app.services.transcription.whisper_local import LocalWhisperProvider


def build_transcription_provider(settings: Settings) -> TranscriptionProvider:
    if settings.transcription_provider == "whisper_local":
        return LocalWhisperProvider(model_size=settings.whisper_model)
    if settings.transcription_provider == "openai":
        if not settings.openai_api_key:
            raise RuntimeError("TRANSCRIPTION_PROVIDER=openai requires OPENAI_API_KEY")
        return OpenAIWhisperProvider(
            api_key=settings.openai_api_key,
            model=settings.whisper_model if settings.whisper_model.startswith("whisper") else "whisper-1",
            base_url=settings.openai_base_url,
        )
    return FakeTranscriptionProvider()


@lru_cache
def get_transcription_provider() -> TranscriptionProvider:
    return build_transcription_provider(get_settings())
