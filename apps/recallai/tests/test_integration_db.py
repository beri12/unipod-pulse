"""Tests that need a live PostgreSQL with pgvector.

Skipped automatically when one is not reachable, so the suite stays runnable
anywhere:

    docker compose up -d postgres
    DATABASE_URL=postgresql+psycopg://recallai:recallai@localhost:5432/recallai \
        pytest -m integration
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest

from app.core.config import Settings
from app.db.models import Base, Group
from app.db.repositories.chunks import PostgresChunkRepository
from app.services.chunking.chunker import MessageInput
from app.services.embeddings.fake import FakeEmbeddingProvider
from app.services.ingestion.service import IngestionService

pytestmark = pytest.mark.integration

DATABASE_URL = os.getenv("DATABASE_URL", "")


@pytest.fixture
async def session():
    if not DATABASE_URL:
        pytest.skip("DATABASE_URL is not set")

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy import text

    engine = create_async_engine(DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await connection.run_sync(Base.metadata.create_all)
    except Exception as error:  # noqa: BLE001
        pytest.skip(f"No reachable PostgreSQL with pgvector: {error}")

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as active:
        yield active

    await engine.dispose()


async def _group(session, name: str) -> Group:
    group = Group(external_group_id=f"{name}-{uuid.uuid4().hex[:8]}", name=name, platform="test")
    session.add(group)
    await session.flush()
    return group


class TestVectorSearch:
    async def test_stores_and_retrieves_a_chunk(self, session):
        settings = Settings(_env_file=None, embedding_dimensions=768)
        embeddings = FakeEmbeddingProvider(768)
        group = await _group(session, "retrieval")

        ingestion = IngestionService(session=session, settings=settings, embeddings=embeddings)
        await ingestion.ingest_messages(
            group_id=group.id,
            messages=[
                MessageInput(
                    "wamid.1",
                    "Alice",
                    "Let's move the deployment to Thursday.",
                    datetime(2026, 9, 18, 10, tzinfo=timezone.utc),
                )
            ],
        )
        await session.flush()

        hits = await PostgresChunkRepository(session).search(
            group_id=group.id,
            embedding=await embeddings.embed("When is the deployment?"),
            question="When is the deployment?",
            limit=5,
            candidates=20,
        )

        assert hits
        assert "Thursday" in hits[0].content

    async def test_never_returns_another_groups_chunks(self, session):
        """The isolation guarantee, against the real query."""
        settings = Settings(_env_file=None, embedding_dimensions=768)
        embeddings = FakeEmbeddingProvider(768)
        mine = await _group(session, "mine")
        theirs = await _group(session, "theirs")

        ingestion = IngestionService(session=session, settings=settings, embeddings=embeddings)
        await ingestion.ingest_messages(
            group_id=theirs.id,
            messages=[
                MessageInput(
                    "wamid.secret",
                    "Someone",
                    "Our deployment is a closely guarded Monday secret.",
                    datetime(2026, 9, 18, 10, tzinfo=timezone.utc),
                )
            ],
        )
        await session.flush()

        hits = await PostgresChunkRepository(session).search(
            group_id=mine.id,
            embedding=await embeddings.embed("When is the deployment?"),
            question="When is the deployment?",
            limit=5,
            candidates=20,
        )

        assert hits == []
