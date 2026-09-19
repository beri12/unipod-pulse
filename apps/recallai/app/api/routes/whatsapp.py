"""The WhatsApp Cloud API webhook.

Incoming messages are both stored as knowledge and, when they are a question,
answered. Answering happens inline because a reply is expected in seconds;
everything slower belongs in a worker.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response

from app.api.deps import IngestionDep, RAGDep, SessionDep, SettingsDep, WhatsAppDep
from app.core.errors import Unauthorized
from app.core.logging import get_logger
from app.db.repositories.groups import ConversationRepository, GroupRepository, UserRepository
from app.services.chunking.chunker import MessageInput
from app.services.messaging.whatsapp import (
    parse_webhook,
    verify_signature,
    verify_subscription,
)
from app.services.rag.citations import format_for_chat

router = APIRouter(prefix="/api/webhooks", tags=["whatsapp"])
logger = get_logger(__name__)

#: A message is treated as a question for the bot when it is addressed to it,
#: or simply ends in a question mark.
MENTION = "@recallai"
COMMANDS = {"/help", "/about", "/search", "/sources", "/status"}


@router.get("/whatsapp", summary="Meta webhook verification")
async def verify(request: Request, settings: SettingsDep) -> Response:
    params = request.query_params
    try:
        challenge = verify_subscription(
            params.get("hub.mode"),
            params.get("hub.verify_token"),
            params.get("hub.challenge"),
            settings.whatsapp_verify_token,
        )
    except PermissionError as error:
        logger.warning("whatsapp_verification_rejected")
        raise Unauthorized(str(error), code="WEBHOOK_VERIFICATION_FAILED") from error

    logger.info("whatsapp_verified")
    return Response(content=challenge, media_type="text/plain")


@router.post("/whatsapp", summary="Inbound WhatsApp events")
async def receive(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    ingestion: IngestionDep,
    rag: RAGDep,
    whatsapp: WhatsAppDep,
) -> dict:
    raw_body = await request.body()
    if not verify_signature(
        raw_body, request.headers.get("x-hub-signature-256"), settings.whatsapp_app_secret
    ):
        # Answer 200 anyway: a non-200 makes Meta retry, and a retry storm is
        # worse than one ignored forgery.
        logger.warning("whatsapp_bad_signature")
        return {"status": "ignored"}

    payload = await request.json()
    inbound = parse_webhook(payload)
    if not inbound:
        return {"status": "ignored"}

    groups = GroupRepository(session)
    users = UserRepository(session)
    handled = 0

    for message in inbound:
        # The group identity comes from the number the message arrived on —
        # never from anything the caller can set.
        external_group_id = message.phone_number_id or "unknown"
        group = await groups.get_or_create(
            external_group_id=external_group_id,
            name=f"WhatsApp {external_group_id}",
            platform="whatsapp",
        )
        user = await users.get_or_create_by_phone(message.from_number, message.sender_name)

        logger.info("message_received", group_id=str(group.id), message_id=message.external_message_id)

        await ingestion.ingest_messages(
            group_id=group.id,
            messages=[
                MessageInput(
                    external_id=message.external_message_id,
                    sender=message.sender_name or message.from_number,
                    text=message.text,
                    timestamp=message.timestamp,
                )
            ],
        )

        question = _as_question(message.text)
        if question is None:
            await session.commit()
            continue

        conversations = ConversationRepository(session)
        conversation = await conversations.get_or_create(group_id=group.id, user_id=user.id)
        history = await conversations.recent_exchanges(conversation.id)

        logger.info("question_received", group_id=str(group.id))
        result = await rag.answer(group_id=group.id, question=question, history=history)

        await whatsapp.send_text(
            message.from_number, format_for_chat(result.answer, result.citations)
        )
        await session.commit()
        handled += 1

    return {"status": "ok", "handled": handled}


def _as_question(text: str) -> str | None:
    """Returns the question to answer, or None to only store the message."""
    stripped = text.strip()
    lowered = stripped.lower()

    if lowered in COMMANDS or lowered.startswith("/search "):
        return _command_text(stripped, lowered)
    if lowered.startswith(MENTION):
        return stripped[len(MENTION) :].strip() or None
    if stripped.endswith("?") or stripped.endswith("؟"):
        return stripped
    return None


def _command_text(stripped: str, lowered: str) -> str | None:
    if lowered.startswith("/search "):
        return stripped[len("/search ") :].strip() or None
    if lowered == "/help":
        return "What can you do?"
    if lowered == "/about":
        return "What is RecallAI?"
    return stripped
