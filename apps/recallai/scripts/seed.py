"""Loads the demo group from the specification.

    python -m scripts.seed

Creates a group, the conversation about the deployment, and a meeting
recording that confirms it — enough to ask the acceptance question against a
real database.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.database import SessionLocal
from app.db.models import Organization, SourceType
from app.db.repositories.groups import GroupRepository
from app.services.chunking.chunker import MessageInput
from app.services.embeddings.factory import build_embedding_provider
from app.services.ingestion.service import IngestionService
from app.services.transcription.base import Segment, Transcript

logger = get_logger("recallai.seed")


def _at(minute: int) -> datetime:
    return datetime(2026, 9, 18, 10, minute, tzinfo=timezone.utc)


CONVERSATION = [
    MessageInput("seed.1", "Alice", "The deployment was originally planned for Wednesday.", _at(0)),
    MessageInput("seed.2", "Bob", "We need more testing before we ship.", _at(2)),
    MessageInput("seed.3", "Alice", "Let's move the deployment to Thursday.", _at(5)),
    MessageInput("seed.4", "Carlos", "Thursday works for me.", _at(7)),
]

MEETING = [
    Segment(2040, 2061, "Let's go through the release plan.", "Alice"),
    Segment(2061, 2080, "We confirmed that deployment will happen Thursday.", "Alice"),
    Segment(2080, 2095, "Everyone agreed on Thursday after the final tests.", "Bob"),
]


async def seed() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)

    async with SessionLocal() as session:
        organization = Organization(name="RecallAI Demo Org")
        session.add(organization)
        await session.flush()

        group = await GroupRepository(session).get_or_create(
            external_group_id="demo-team", name="RecallAI Demo Team", platform="whatsapp"
        )
        group.organization_id = organization.id
        await session.flush()

        ingestion = IngestionService(
            session=session,
            settings=settings,
            embeddings=build_embedding_provider(settings),
        )

        messages = await ingestion.ingest_messages(group_id=group.id, messages=CONVERSATION)
        meeting = await ingestion.ingest_transcript(
            group_id=group.id,
            title="Weekly Team Meeting",
            transcript=Transcript(
                text="\n".join(segment.text for segment in MEETING),
                segments=MEETING,
                duration=2095,
            ),
            occurred_at=datetime(2026, 9, 19, 9, 0, tzinfo=timezone.utc),
            source_type=SourceType.MEETING,
        )
        await session.commit()

    print("\nSeeded the demo group.\n")
    print(f"  group_id : {group.id}")
    print(f"  messages : {messages.chunks} chunk(s)")
    print(f"  meeting  : {meeting.chunks} chunk(s)\n")
    print("Ask it something:\n")
    print("  curl -s localhost:8000/api/ask -H 'content-type: application/json' \\")
    print(f"""    -d '{{"group_id":"{group.id}","question":"When is the deployment?"}}' | jq\n""")


if __name__ == "__main__":
    asyncio.run(seed())
