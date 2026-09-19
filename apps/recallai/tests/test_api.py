"""HTTP behaviour of the real application, with the database faked out."""

import hashlib
import hmac
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_rag_service
from app.core.config import Settings, get_settings
from app.db.database import get_session
from app.db.models import Group
from app.main import create_app
from app.services.embeddings.fake import FakeEmbeddingProvider
from app.services.language.detector import language_service
from app.services.llm.base import LLMAnswer
from app.services.rag.service import NOT_FOUND, RAGService
from tests.fakes import InMemoryChunkRepository, ScriptedLLM, StoredChunk

GROUP_ID = uuid.uuid4()
VERIFY_TOKEN = "verify-me"
APP_SECRET = "app-secret"


class FakeResult:
    def __init__(self, rows=None):
        self._rows = rows or []

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None

    def scalars(self):
        return iter(self._rows)

    def all(self):
        return list(self._rows)


class FakeSession:
    """Just enough session for the routes: lookups, inserts, no persistence."""

    def __init__(self, group: Group | None):
        self.group = group
        self.added: list = []
        self.committed = False

    async def get(self, model, primary_key):
        if model is Group and self.group is not None and primary_key == self.group.id:
            return self.group
        return None

    async def execute(self, statement, params=None):
        return FakeResult()

    def add(self, instance):
        self.added.append(instance)

    async def flush(self):
        # SQLAlchemy assigns the default primary key here; the routes read it.
        for instance in self.added:
            if getattr(instance, "id", None) is None:
                instance.id = uuid.uuid4()

    async def commit(self):
        self.committed = True
        await self.flush()


def build_client(chunks=None, llm=None, group_exists=True, **settings_overrides):
    settings = Settings(
        _env_file=None,
        embedding_dimensions=64,
        whatsapp_verify_token=VERIFY_TOKEN,
        **settings_overrides,
    )
    group = (
        Group(id=GROUP_ID, external_group_id="111", name="Demo", platform="whatsapp")
        if group_exists
        else None
    )
    session = FakeSession(group)

    rag = RAGService(
        settings=settings,
        chunks=InMemoryChunkRepository(chunks or []),
        embeddings=FakeEmbeddingProvider(64),
        llm=llm or ScriptedLLM(LLMAnswer(answer=None, confidence="unsupported")),
        language=language_service,
    )

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_rag_service] = lambda: rag
    return TestClient(app), session


@pytest.fixture
def knowledge():
    return [
        StoredChunk(
            group_id=GROUP_ID,
            chunk_id="chunk-1",
            source_id="source-1",
            content="[2026-09-18 10:05] Alice: Let's move the deployment to Thursday.",
            occurred_at="2026-09-18T10:05:00",
            chunk_metadata={"senders": ["Alice"]},
        )
    ]


class TestHealth:
    def test_liveness_is_always_ok(self):
        client, _ = build_client()
        response = client.get("/health")

        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_every_response_carries_a_request_id(self):
        client, _ = build_client()
        assert client.get("/health").headers["x-request-id"]

    def test_a_supplied_request_id_is_echoed(self):
        client, _ = build_client()
        response = client.get("/health", headers={"x-request-id": "trace-me"})

        assert response.headers["x-request-id"] == "trace-me"


class TestAsk:
    def test_answers_with_sources(self, knowledge):
        llm = ScriptedLLM(
            LLMAnswer(answer="Thursday.", confidence="supported", cited_chunk_ids=["chunk-1"])
        )
        client, session = build_client(knowledge, llm=llm)

        response = client.post(
            "/api/ask", json={"group_id": str(GROUP_ID), "question": "When is the deployment?"}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["answer"] == "Thursday."
        assert body["language"] == "en"
        assert body["confidence"] == "supported"
        assert body["sources"][0]["chunk_id"] == "chunk-1"
        assert "Alice" in body["sources"][0]["label"]
        assert session.committed

    def test_refuses_when_the_knowledge_does_not_cover_it(self, knowledge):
        client, _ = build_client(knowledge)

        response = client.post(
            "/api/ask", json={"group_id": str(GROUP_ID), "question": "Who owns the servers?"}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["answer"] == NOT_FOUND["en"]
        assert body["confidence"] == "unsupported"
        assert body["sources"] == []

    def test_answers_a_french_question_in_french(self):
        client, _ = build_client([])

        response = client.post(
            "/api/ask",
            json={"group_id": str(GROUP_ID), "question": "Quand est prévu le déploiement ?"},
        )

        body = response.json()
        assert body["language"] == "fr"
        assert body["answer"] == NOT_FOUND["fr"]

    def test_unknown_group_is_a_clean_404(self):
        client, _ = build_client(group_exists=False)

        response = client.post(
            "/api/ask", json={"group_id": str(uuid.uuid4()), "question": "When?"}
        )

        assert response.status_code == 404
        assert response.json() == {
            "error": {"code": "GROUP_NOT_FOUND", "message": "Unknown group"}
        }

    def test_an_empty_question_is_rejected(self):
        client, _ = build_client()

        response = client.post("/api/ask", json={"group_id": str(GROUP_ID), "question": ""})

        assert response.status_code == 422

    def test_a_missing_group_id_is_rejected(self):
        client, _ = build_client()

        assert client.post("/api/ask", json={"question": "When?"}).status_code == 422


class TestSearch:
    def test_returns_hits_with_both_scores(self, knowledge):
        client, _ = build_client(knowledge)

        response = client.post(
            "/api/search", json={"group_id": str(GROUP_ID), "query": "deployment"}
        )

        assert response.status_code == 200
        hit = response.json()["hits"][0]
        assert hit["chunk_id"] == "chunk-1"
        assert "vector_score" in hit and "keyword_score" in hit


class TestWhatsAppWebhook:
    def test_verification_echoes_the_challenge(self):
        client, _ = build_client()

        response = client.get(
            "/api/webhooks/whatsapp",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": VERIFY_TOKEN,
                "hub.challenge": "1158201444",
            },
        )

        assert response.status_code == 200
        assert response.text == "1158201444"

    def test_verification_rejects_a_wrong_token(self):
        client, _ = build_client()

        response = client.get(
            "/api/webhooks/whatsapp",
            params={
                "hub.mode": "subscribe",
                "hub.verify_token": "wrong",
                "hub.challenge": "1158201444",
            },
        )

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "WEBHOOK_VERIFICATION_FAILED"

    def test_an_unsigned_delivery_is_ignored_but_answered_200(self):
        # Anything but 200 makes Meta retry; a retry storm is worse than one
        # ignored forgery.
        client, _ = build_client(whatsapp_app_secret=APP_SECRET)

        response = client.post(
            "/api/webhooks/whatsapp", json={"entry": [{"changes": [{"value": {}}]}]}
        )

        assert response.status_code == 200
        assert response.json()["status"] == "ignored"

    def test_a_correctly_signed_delivery_is_accepted(self):
        client, _ = build_client(whatsapp_app_secret=APP_SECRET)
        body = json.dumps({"entry": [{"changes": [{"value": {"statuses": []}}]}]}).encode()
        signature = "sha256=" + hmac.new(APP_SECRET.encode(), body, hashlib.sha256).hexdigest()

        response = client.post(
            "/api/webhooks/whatsapp",
            content=body,
            headers={"content-type": "application/json", "x-hub-signature-256": signature},
        )

        assert response.status_code == 200

    def test_a_malformed_body_does_not_crash_the_webhook(self):
        client, _ = build_client()

        response = client.post("/api/webhooks/whatsapp", json={"entry": "not-a-list"})

        assert response.status_code == 200


class TestDocumentation:
    def test_openapi_is_served(self):
        client, _ = build_client()
        schema = client.get("/openapi.json").json()

        assert schema["info"]["title"] == "RecallAI"
        assert "/api/ask" in schema["paths"]
        assert "/api/knowledge/documents" in schema["paths"]

    def test_debug_endpoints_are_off_by_default(self):
        client, _ = build_client()
        assert client.get(f"/api/debug/chunks/{GROUP_ID}").status_code == 404
