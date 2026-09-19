"""The scenario from the specification, end to end.

Messages and a meeting recording go in; a question in English and the same
question in French come out answered, with the sources that support them.
Persistence is the only part left out — see tests/test_integration_db.py.
"""

import uuid
from datetime import datetime, timezone

import pytest

from app.core.config import Settings
from app.services.chunking.chunker import MessageInput, chunk_messages, chunk_transcript
from app.services.embeddings.fake import FakeEmbeddingProvider
from app.services.language.detector import language_service
from app.services.llm.fake import FakeLLMProvider
from app.services.rag.citations import format_for_chat
from app.services.rag.service import RAGService
from app.services.transcription.base import Segment
from tests.fakes import InMemoryChunkRepository, StoredChunk

GROUP = uuid.uuid4()


def at(minute: int) -> datetime:
    return datetime(2026, 9, 18, 10, minute, tzinfo=timezone.utc)


@pytest.fixture
def service():
    """A group whose memory holds a conversation and a recorded meeting."""
    repository = InMemoryChunkRepository()

    # Step 1 — the WhatsApp conversation.
    conversation = [
        MessageInput("wamid.1", "Alice", "The deployment was originally planned for Wednesday.", at(0)),
        MessageInput("wamid.2", "Bob", "We need more testing.", at(2)),
        MessageInput("wamid.3", "Alice", "Let's move the deployment to Thursday.", at(5)),
    ]
    for chunk in chunk_messages(conversation):
        repository.add(
            StoredChunk(
                group_id=GROUP,
                chunk_id=f"message-{chunk.index}",
                source_id="source-messages",
                content=chunk.content,
                source_type="MESSAGE",
                source_title="WhatsApp message",
                occurred_at="2026-09-18T10:00:00",
                chunk_metadata=chunk.metadata,
            )
        )

    # Steps 2-4 — the recording, transcribed and chunked with its timestamps.
    segments = [
        Segment(2061, 2075, "We confirmed that deployment will happen Thursday.", "Alice"),
        Segment(2075, 2090, "Everyone agreed on Thursday.", "Bob"),
    ]
    for chunk in chunk_transcript(segments, 1200):
        repository.add(
            StoredChunk(
                group_id=GROUP,
                chunk_id=f"meeting-{chunk.index}",
                source_id="source-meeting",
                content=chunk.content,
                source_type="MEETING",
                source_title="Weekly Team Meeting",
                chunk_metadata=chunk.metadata,
            )
        )

    return RAGService(
        settings=Settings(_env_file=None, embedding_dimensions=64),
        chunks=repository,
        embeddings=FakeEmbeddingProvider(64),
        llm=FakeLLMProvider(),
        language=language_service,
    )


class TestAcceptance:
    async def test_english_question_is_answered_with_sources(self, service):
        # Steps 5-7.
        result = await service.answer(group_id=GROUP, question="When is the deployment?")

        assert result.confidence == "supported"
        assert "Thursday" in result.answer
        # Not the superseded Wednesday plan.
        assert "Wednesday" not in result.answer
        assert result.citations

        reply = format_for_chat(result.answer, result.citations)
        assert "Sources:" in reply

    async def test_a_meeting_source_is_citable_by_its_timestamp(self, service):
        # Phrased to match the recording rather than the chat, so the meeting
        # chunk wins retrieval and the citation carries its timestamp.
        result = await service.answer(group_id=GROUP, question="When will deployment happen?")

        assert result.confidence == "supported"
        labels = " ".join(citation.label for citation in result.citations)
        assert "00:34:21" in labels
        assert "Weekly Team Meeting" in labels

    async def test_the_same_question_in_french_is_answered_in_french(self, service):
        # Steps 8-9.
        result = await service.answer(
            group_id=GROUP, question="Quand est prévu le déploiement ?"
        )

        assert result.language == "fr"

    async def test_an_unrelated_question_is_refused(self, service):
        result = await service.answer(group_id=GROUP, question="What is the office wifi password?")

        assert result.confidence == "unsupported"
        assert result.citations == []

    async def test_another_group_sees_none_of_it(self, service):
        result = await service.answer(group_id=uuid.uuid4(), question="When is the deployment?")

        assert result.confidence == "unsupported"
        assert result.retrieved == []
