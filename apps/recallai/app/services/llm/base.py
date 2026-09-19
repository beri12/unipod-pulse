"""Language model providers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass(slots=True)
class ContextChunk:
    """One retrieved chunk, as the model sees it."""

    chunk_id: str
    source_id: str
    source_type: str
    title: str
    content: str
    occurred_at: str | None = None
    extra: dict = field(default_factory=dict)


@dataclass(slots=True)
class LLMAnswer:
    """What a provider must return, whatever its wire format."""

    answer: str | None
    #: "supported" when the context carries the answer, "unsupported" otherwise.
    confidence: str = "unsupported"
    #: Chunk ids the model says it used. Always re-checked against what was
    #: actually retrieved — a model may not invent a citation.
    cited_chunk_ids: list[str] = field(default_factory=list)
    model: str = ""


@runtime_checkable
class LLMProvider(Protocol):
    name: str
    model: str

    async def generate(
        self, *, system_prompt: str, user_prompt: str, context: list[ContextChunk]
    ) -> LLMAnswer: ...
