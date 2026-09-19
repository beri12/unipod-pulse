"""Embeddings from a local Ollama server."""

from __future__ import annotations

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)


class OllamaEmbeddingProvider:
    name = "ollama"

    def __init__(self, base_url: str, model: str, dimensions: int, timeout: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.dimensions = dimensions
        self._timeout = timeout

    async def embed(self, text: str) -> list[float]:
        return (await self.embed_batch([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/embed", json={"model": self.model, "input": texts}
            )
            response.raise_for_status()
            payload = response.json()

        embeddings = payload.get("embeddings") or []
        if len(embeddings) != len(texts):
            raise RuntimeError(f"Ollama returned {len(embeddings)} embeddings for {len(texts)} texts")

        for embedding in embeddings:
            if len(embedding) != self.dimensions:
                # Storing a wrong-width vector would fail at the database, far
                # from the cause; say it here instead.
                raise RuntimeError(
                    f"Model '{self.model}' returns {len(embedding)} dimensions but the database "
                    f"column expects {self.dimensions}. Set EMBEDDING_DIMENSIONS and re-run migrations."
                )
        return embeddings
