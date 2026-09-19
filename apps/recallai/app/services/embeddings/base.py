"""Embedding providers.

The application depends on this interface, never on a vendor, so a group's
knowledge can be re-embedded with a different model without touching the RAG
code.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class EmbeddingProvider(Protocol):
    name: str
    dimensions: int

    async def embed(self, text: str) -> list[float]: ...

    async def embed_batch(self, texts: list[str]) -> list[list[float]]: ...
