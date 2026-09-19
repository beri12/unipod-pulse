"""Groups, users and conversations."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Conversation, Group, Message, Query, User


class GroupRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, group_id: uuid.UUID) -> Group | None:
        return await self._session.get(Group, group_id)

    async def list_all(self, limit: int = 100) -> list[Group]:
        rows = await self._session.execute(select(Group).order_by(Group.name).limit(limit))
        return list(rows.scalars())

    async def get_or_create(
        self, *, external_group_id: str, name: str, platform: str = "whatsapp"
    ) -> Group:
        """Finds a group by its platform identity, creating it on first sight.

        A WhatsApp conversation announces itself before anyone has registered
        it, so ingestion must be able to create the group it belongs to —
        while never guessing which existing group a message belongs to.
        """
        rows = await self._session.execute(
            select(Group).where(
                Group.platform == platform, Group.external_group_id == external_group_id
            )
        )
        group = rows.scalar_one_or_none()
        if group:
            return group

        group = Group(external_group_id=external_group_id, name=name, platform=platform)
        self._session.add(group)
        await self._session.flush()
        return group


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_or_create_by_phone(self, phone_number: str, name: str | None = None) -> User:
        rows = await self._session.execute(select(User).where(User.phone_number == phone_number))
        user = rows.scalar_one_or_none()
        if user:
            if name and not user.name:
                user.name = name
            return user

        user = User(phone_number=phone_number, name=name)
        self._session.add(user)
        await self._session.flush()
        return user


class ConversationRepository:
    """Short-term chat memory, kept separate from group knowledge."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_or_create(self, *, group_id: uuid.UUID, user_id: uuid.UUID | None) -> Conversation:
        rows = await self._session.execute(
            select(Conversation)
            .where(Conversation.group_id == group_id, Conversation.user_id == user_id)
            .order_by(Conversation.created_at.desc())
            .limit(1)
        )
        conversation = rows.scalar_one_or_none()
        if conversation:
            return conversation

        conversation = Conversation(group_id=group_id, user_id=user_id)
        self._session.add(conversation)
        await self._session.flush()
        return conversation

    async def recent_exchanges(
        self, conversation_id: uuid.UUID, limit: int = 3
    ) -> list[tuple[str, str]]:
        """The last few question/answer pairs, oldest first."""
        from app.db.models import Answer

        rows = await self._session.execute(
            select(Query.question, Answer.answer)
            .join(Answer, Answer.query_id == Query.id)
            .where(Query.conversation_id == conversation_id)
            .order_by(Query.created_at.desc())
            .limit(limit)
        )
        return list(reversed([(question, answer) for question, answer in rows.all()]))


class MessageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_group(self, group_id: uuid.UUID, limit: int = 100) -> list[Message]:
        rows = await self._session.execute(
            select(Message)
            .where(Message.group_id == group_id)
            .order_by(Message.timestamp.desc())
            .limit(limit)
        )
        return list(rows.scalars())

    async def existing_external_ids(
        self, group_id: uuid.UUID, external_ids: list[str]
    ) -> set[str]:
        """Which of these the group already has — ingestion must be idempotent."""
        if not external_ids:
            return set()
        rows = await self._session.execute(
            select(Message.external_message_id).where(
                Message.group_id == group_id,
                Message.external_message_id.in_(external_ids),
            )
        )
        return {value for (value,) in rows.all() if value}
