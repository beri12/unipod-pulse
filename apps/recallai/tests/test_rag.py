"""The answering pipeline: grounded, cited, and never crossing a group."""

import uuid

import pytest

from app.core.config import Settings
from app.services.embeddings.fake import FakeEmbeddingProvider
from app.services.language.detector import language_service
from app.services.llm.base import LLMAnswer
from app.services.llm.fake import FakeLLMProvider
from app.services.rag.service import NOT_FOUND, RAGService
from tests.fakes import InMemoryChunkRepository, ScriptedLLM, StoredChunk

GROUP_A = uuid.uuid4()
GROUP_B = uuid.uuid4()


def build(chunks: list[StoredChunk], llm=None):
    repository = InMemoryChunkRepository(chunks)
    service = RAGService(
        settings=Settings(_env_file=None, embedding_dimensions=64),
        chunks=repository,
        embeddings=FakeEmbeddingProvider(64),
        llm=llm or FakeLLMProvider(),
        language=language_service,
    )
    return service, repository


DEPLOYMENT_MESSAGE = StoredChunk(
    group_id=GROUP_A,
    chunk_id="chunk-message",
    source_id="source-message",
    content=(
        "[2026-09-18 10:00] Alice: The deployment was originally planned for Wednesday.\n"
        "[2026-09-18 10:02] Bob: We need more testing.\n"
        "[2026-09-18 10:05] Alice: Let's move the deployment to Thursday."
    ),
    occurred_at="2026-09-18T10:00:00",
    chunk_metadata={"senders": ["Alice", "Bob"]},
)

DEPLOYMENT_MEETING = StoredChunk(
    group_id=GROUP_A,
    chunk_id="chunk-meeting",
    source_id="source-meeting",
    content="00:34:21 We confirmed that deployment will happen Thursday.",
    source_type="MEETING",
    source_title="Weekly Team Meeting",
    chunk_metadata={"timestamp": "00:34:21"},
)


class TestGroupIsolation:
    """The security boundary of the product."""

    async def test_another_group_knowledge_is_never_retrieved(self):
        secret = StoredChunk(
            group_id=GROUP_B,
            chunk_id="chunk-secret",
            source_id="source-secret",
            content="Group B deployment is on Monday.",
        )
        service, _ = build([secret])

        result = await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert result.answer == NOT_FOUND["en"]
        assert result.citations == []
        assert result.retrieved == []

    async def test_retrieval_is_always_scoped_to_the_asking_group(self):
        service, repository = build([DEPLOYMENT_MESSAGE])

        await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert repository.calls[0]["group_id"] == GROUP_A

    async def test_each_group_gets_its_own_answer(self):
        chunks = [
            DEPLOYMENT_MESSAGE,
            StoredChunk(
                group_id=GROUP_B,
                chunk_id="chunk-b",
                source_id="source-b",
                content="The deployment for this team is on Monday.",
            ),
        ]
        service, _ = build(chunks)

        answer_a = await service.answer(group_id=GROUP_A, question="When is the deployment?")
        answer_b = await service.answer(group_id=GROUP_B, question="When is the deployment?")

        assert "Thursday" in answer_a.answer
        assert "Monday" in answer_b.answer
        assert "Monday" not in answer_a.answer


class TestGroundedAnswers:
    async def test_answers_from_the_group_knowledge(self):
        service, _ = build([DEPLOYMENT_MESSAGE, DEPLOYMENT_MEETING])

        result = await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert result.confidence == "supported"
        assert "Thursday" in result.answer
        assert result.citations

    async def test_refuses_when_nothing_is_known(self):
        service, _ = build([])

        result = await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert result.answer == NOT_FOUND["en"]
        assert result.confidence == "unsupported"

    async def test_refuses_when_the_model_cannot_answer(self):
        service, _ = build(
            [DEPLOYMENT_MESSAGE],
            llm=ScriptedLLM(LLMAnswer(answer=None, confidence="unsupported")),
        )

        result = await service.answer(group_id=GROUP_A, question="Who owns the servers?")

        assert result.answer == NOT_FOUND["en"]
        assert result.citations == []

    async def test_a_refusal_carries_no_citations(self):
        # Citing sources for an answer that was not given would be a lie.
        service, _ = build(
            [DEPLOYMENT_MESSAGE],
            llm=ScriptedLLM(LLMAnswer(answer=None, confidence="unsupported")),
        )

        result = await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert result.citations == []

    async def test_an_unsupported_answer_is_discarded_even_if_text_was_returned(self):
        service, _ = build(
            [DEPLOYMENT_MESSAGE],
            llm=ScriptedLLM(LLMAnswer(answer="Probably Friday", confidence="unsupported")),
        )

        result = await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert "Friday" not in result.answer
        assert result.answer == NOT_FOUND["en"]

    async def test_an_empty_question_is_refused(self):
        service, _ = build([DEPLOYMENT_MESSAGE])

        assert (await service.answer(group_id=GROUP_A, question="   ")).confidence == "unsupported"


class TestCitations:
    async def test_the_model_cannot_invent_a_source(self):
        service, _ = build(
            [DEPLOYMENT_MESSAGE],
            llm=ScriptedLLM(
                LLMAnswer(
                    answer="Thursday.",
                    confidence="supported",
                    cited_chunk_ids=["chunk-that-does-not-exist"],
                )
            ),
        )

        result = await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert [citation.chunk_id for citation in result.citations] == ["chunk-message"]

    async def test_a_meeting_citation_carries_its_timestamp(self):
        service, _ = build(
            [DEPLOYMENT_MEETING],
            llm=ScriptedLLM(
                LLMAnswer(answer="Thursday.", confidence="supported", cited_chunk_ids=["chunk-meeting"])
            ),
        )

        result = await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert result.citations[0].timestamp == "00:34:21"
        assert result.citations[0].label == "Weekly Team Meeting — 00:34:21"


class TestLanguage:
    async def test_english_question_is_answered_in_english(self):
        service, _ = build([DEPLOYMENT_MESSAGE])

        result = await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert result.language == "en"

    async def test_french_question_is_answered_in_french(self):
        service, _ = build([])

        result = await service.answer(
            group_id=GROUP_A, question="Quand est prévu le déploiement ?"
        )

        assert result.language == "fr"
        assert result.answer == NOT_FOUND["fr"]

    async def test_the_prompt_asks_for_the_detected_language(self):
        # The chunk is French because the offline embedder is a hashing
        # vectoriser with no cross-lingual ability; a real embedding model
        # matches across languages, which is the point of using one.
        french_chunk = StoredChunk(
            group_id=GROUP_A,
            chunk_id="chunk-fr",
            source_id="source-fr",
            content="Le déploiement est déplacé à jeudi.",
        )
        llm = ScriptedLLM(LLMAnswer(answer="Jeudi.", confidence="supported"))
        service, _ = build([french_chunk], llm=llm)

        await service.answer(group_id=GROUP_A, question="Quand est le déploiement ?")

        assert "French" in llm.prompts[0]


class TestConversationMemory:
    async def test_recent_exchanges_are_offered_to_the_model(self):
        llm = ScriptedLLM(LLMAnswer(answer="Alice did.", confidence="supported"))
        service, _ = build([DEPLOYMENT_MESSAGE], llm=llm)

        await service.answer(
            group_id=GROUP_A,
            question="Who decided that?",
            history=[("When is the deployment?", "Thursday.")],
        )

        prompt = llm.prompts[0]
        assert "Earlier in this conversation" in prompt
        assert "Thursday." in prompt

    async def test_history_is_optional(self):
        llm = ScriptedLLM(LLMAnswer(answer="Thursday.", confidence="supported"))
        service, _ = build([DEPLOYMENT_MESSAGE], llm=llm)

        await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert "Earlier in this conversation" not in llm.prompts[0]


class TestContextGivenToTheModel:
    async def test_chunk_ids_are_exposed_so_they_can_be_cited(self):
        llm = ScriptedLLM(LLMAnswer(answer="Thursday.", confidence="supported"))
        service, _ = build([DEPLOYMENT_MESSAGE, DEPLOYMENT_MEETING], llm=llm)

        await service.answer(group_id=GROUP_A, question="When is the deployment?")

        assert {chunk.chunk_id for chunk in llm.seen[0]} == {"chunk-message", "chunk-meeting"}
        assert "chunk_id: chunk-message" in llm.prompts[0]
