"""Offline embeddings: a hashing vectoriser.

Not a language model, but not a random stub either — texts that share words
land close together, so semantic search, the seed data and the tests all
behave sensibly with no model server running.
"""

from __future__ import annotations

import hashlib
import math
import re

_TOKEN = re.compile(r"\w+", re.UNICODE)


class FakeEmbeddingProvider:
    name = "fake"

    def __init__(self, dimensions: int = 768) -> None:
        self.dimensions = dimensions

    async def embed(self, text: str) -> list[float]:
        return self.embed_sync(text)

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_sync(text) for text in texts]

    def embed_sync(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        for token in _TOKEN.findall(text.lower()):
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
            bucket = int.from_bytes(digest[:4], "big") % self.dimensions
            # A sign bit keeps unrelated tokens from always adding up.
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[bucket] += sign

        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0:
            return vector
        return [value / norm for value in vector]
