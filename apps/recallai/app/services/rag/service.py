"""The retrieval-augmented answering pipeline."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

from app.core.config import Settings
from app.core.logging import get_logger
from app.db.repositories.chunks import ChunkRepository, RetrievedChunk
from app.services.embeddings.base import EmbeddingProvider
from app.services.language.detector import LanguageService
from app.services.llm.base import ContextChunk, LLMProvider
from app.services.llm.prompt import SYSTEM_PROMPT, build_user_prompt
from app.services.rag.citations import Citation, build_citations

logger = get_logger(__name__)

#: Said when the group's knowledge does not answer the question. Guessing here
#: is the one failure that makes the whole product untrustworthy.
NOT_FOUND = {
    "en": "I couldn't find enough information in the group's memory to answer that confidently.",
    "fr": "Je n'ai pas trouvé suffisamment d'informations dans la mémoire du groupe pour répondre avec certitude.",
}


@dataclass(slots=True)
class AnswerResult:
    answer: str
    language: str
    confidence: str
    citations: list[Citation] = field(default_factory=list)
    retrieved: list[RetrievedChunk] = field(default_factory=list)
    model: str = ""
    took_ms: int = 0

    @property
    def supported(self) -> bool:
        return self.confidence == "supported"


class RAGService:
    def __init__(
        self,
        *,
        settings: Settings,
        chunks: ChunkRepository,
        embeddings: EmbeddingProvider,
        llm: LLMProvider,
        language: LanguageService,
    ) -> None:
        self._settings = settings
        self._chunks = chunks
        self._embeddings = embeddings
        self._llm = llm
        self._language = language

    async def answer(
        self,
        *,
        group_id: uuid.UUID,
        question: str,
        history: list[tuple[str, str]] | None = None,
    ) -> AnswerResult:
        started = time.perf_counter()
        question = (question or "").strip()
        language = self._language.reply_language(question)

        if not question:
            return AnswerResult(
                answer=NOT_FOUND[language], language=language, confidence="unsupported"
            )

        logger.info("retrieval_started", group_id=str(group_id), language=language)
        retrieved = await self._retrieve(group_id=group_id, question=question)
        logger.info("retrieval_completed", group_id=str(group_id), chunks=len(retrieved))

        if not retrieved:
            return self._refusal(language, started)

        context = [_to_context(chunk) for chunk in retrieved]
        prompt = build_user_prompt(
            _with_history(question, history), context=context, language=language
        )

        logger.info("llm_started", provider=self._llm.name, model=self._llm.model)
        result = await self._llm.generate(
            system_prompt=SYSTEM_PROMPT, user_prompt=prompt, context=context
        )
        logger.info("llm_completed", confidence=result.confidence)

        if not result.answer or result.confidence != "supported":
            return self._refusal(language, started, retrieved=retrieved, model=result.model)

        citations = build_citations(retrieved, result.cited_chunk_ids)
        return AnswerResult(
            answer=result.answer,
            language=language,
            confidence="supported",
            citations=citations,
            retrieved=retrieved,
            model=result.model,
            took_ms=_elapsed(started),
        )

    async def _retrieve(self, *, group_id: uuid.UUID, question: str) -> list[RetrievedChunk]:
        embedding = await self._embeddings.embed(question)
        return await self._chunks.search(
            group_id=group_id,
            embedding=embedding,
            question=question,
            limit=self._settings.retrieval_top_k,
            candidates=self._settings.retrieval_candidates,
        )

    def _refusal(
        self,
        language: str,
        started: float,
        retrieved: list[RetrievedChunk] | None = None,
        model: str = "",
    ) -> AnswerResult:
        return AnswerResult(
            answer=NOT_FOUND[language],
            language=language,
            confidence="unsupported",
            # No citations: nothing was answered, so nothing supports it.
            citations=[],
            retrieved=retrieved or [],
            model=model,
            took_ms=_elapsed(started),
        )


def _to_context(chunk: RetrievedChunk) -> ContextChunk:
    return ContextChunk(
        chunk_id=chunk.chunk_id,
        source_id=chunk.source_id,
        source_type=chunk.source_type,
        title=chunk.source_title,
        content=chunk.content,
        occurred_at=chunk.occurred_at,
        extra=chunk.chunk_metadata or {},
    )


def _with_history(question: str, history: list[tuple[str, str]] | None) -> str:
    """Short-term conversation context, kept apart from group knowledge.

    It only resolves what "that" refers to; facts still have to come from
    retrieved chunks.
    """
    if not history:
        return question

    lines = [f"Earlier in this conversation:"]
    for asked, answered in history[-3:]:
        lines.append(f"Q: {asked}")
        lines.append(f"A: {answered}")
    lines.append(f"\nCurrent question: {question}")
    return "\n".join(lines)


def _elapsed(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
