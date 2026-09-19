from __future__ import annotations

from functools import lru_cache

from app.core.config import Settings, get_settings
from app.services.llm.base import LLMProvider
from app.services.llm.fake import FakeLLMProvider
from app.services.llm.ollama import OllamaLLMProvider
from app.services.llm.openai import OpenAILLMProvider


def build_llm_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "ollama":
        return OllamaLLMProvider(base_url=settings.ollama_base_url, model=settings.ollama_model)
    if settings.llm_provider == "openai":
        if not settings.openai_api_key:
            raise RuntimeError("LLM_PROVIDER=openai requires OPENAI_API_KEY")
        return OpenAILLMProvider(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            base_url=settings.openai_base_url,
        )
    return FakeLLMProvider()


@lru_cache
def get_llm_provider() -> LLMProvider:
    return build_llm_provider(get_settings())
