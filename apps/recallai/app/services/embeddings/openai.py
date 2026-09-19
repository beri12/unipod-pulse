"""Embeddings from OpenAI or any OpenAI-compatible endpoint."""

from __future__ import annotations

import httpx


class OpenAIEmbeddingProvider:
    name = "openai"

    def __init__(
        self, api_key: str, model: str, dimensions: int, base_url: str, timeout: float = 60.0
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.dimensions = dimensions
        self.base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def embed(self, text: str) -> list[float]:
        return (await self.embed_batch([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self.base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "input": texts},
            )
            response.raise_for_status()
            payload = response.json()

        ordered = sorted(payload["data"], key=lambda item: item["index"])
        return [item["embedding"] for item in ordered]
