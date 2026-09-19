"""Asking questions, and searching without a model."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import RAGDep, SessionDep
from app.core.errors import NotFound
from app.core.logging import get_logger
from app.db.models import Answer, AnswerSource, Query
from app.db.repositories.groups import ConversationRepository, GroupRepository
from app.schemas import AskRequest, AskResponse, SearchHit, SearchRequest, SearchResponse, SourceOut

router = APIRouter(prefix="/api", tags=["ask"])
logger = get_logger(__name__)


@router.post("/ask", response_model=AskResponse, summary="Ask the group's memory")
async def ask(request: AskRequest, rag: RAGDep, session: SessionDep) -> AskResponse:
    group = await GroupRepository(session).get(request.group_id)
    if group is None:
        raise NotFound("Unknown group", code="GROUP_NOT_FOUND")

    conversations = ConversationRepository(session)
    conversation = await conversations.get_or_create(
        group_id=request.group_id, user_id=request.user_id
    )
    history = (
        await conversations.recent_exchanges(conversation.id)
        if request.use_conversation_memory
        else []
    )

    result = await rag.answer(
        group_id=request.group_id, question=request.question, history=history
    )

    query = Query(
        conversation_id=conversation.id, question=request.question, language=result.language
    )
    session.add(query)
    await session.flush()

    answer = Answer(
        query_id=query.id,
        answer=result.answer,
        model=result.model,
        confidence=result.confidence,
    )
    session.add(answer)
    await session.flush()

    for citation in result.citations:
        session.add(
            AnswerSource(
                answer_id=answer.id,
                source_id=citation.source_id,
                chunk_id=citation.chunk_id,
                relevance_score=citation.relevance,
            )
        )
    await session.commit()

    logger.info(
        "answer_sent",
        group_id=str(request.group_id),
        confidence=result.confidence,
        sources=len(result.citations),
        took_ms=result.took_ms,
    )
    return AskResponse(
        answer=result.answer,
        language=result.language,
        confidence=result.confidence,
        sources=[SourceOut(**citation.as_dict()) for citation in result.citations],
        model=result.model,
        took_ms=result.took_ms,
    )


@router.post("/search", response_model=SearchResponse, summary="Retrieval only, no model")
async def search(request: SearchRequest, rag: RAGDep, session: SessionDep) -> SearchResponse:
    if await GroupRepository(session).get(request.group_id) is None:
        raise NotFound("Unknown group", code="GROUP_NOT_FOUND")

    chunks = await rag._retrieve(group_id=request.group_id, question=request.query)
    return SearchResponse(
        hits=[
            SearchHit(
                chunk_id=chunk.chunk_id,
                source_id=chunk.source_id,
                source_type=chunk.source_type,
                title=chunk.source_title,
                content=chunk.content,
                score=round(chunk.score, 4),
                vector_score=round(chunk.vector_score, 4),
                keyword_score=round(chunk.keyword_score, 4),
            )
            for chunk in chunks[: request.limit]
        ]
    )
