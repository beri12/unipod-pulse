from __future__ import annotations

from functools import lru_cache

from app.core.config import Settings, get_settings
from app.services.embeddings.base import EmbeddingProvider
from app.services.embeddings.fake import FakeEmbeddingProvider
from app.services.embeddings.ollama import OllamaEmbeddingProvider
from app.services.embeddings.openai import OpenAIEmbeddingProvider


def build_embedding_provider(settings: Settings) -> EmbeddingProvider:
    if settings.embedding_provider == "ollama":
        return OllamaEmbeddingProvider(
            base_url=settings.ollama_base_url,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
        )
    if settings.embedding_provider == "openai":
        if not settings.openai_api_key:
            raise RuntimeError("EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY")
        return OpenAIEmbeddingProvider(
            api_key=settings.openai_api_key,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
            base_url=settings.openai_base_url,
        )
    return FakeEmbeddingProvider(dimensions=settings.embedding_dimensions)


@lru_cache
def get_embedding_provider() -> EmbeddingProvider:
    return build_embedding_provider(get_settings())
