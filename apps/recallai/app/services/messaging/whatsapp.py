"""Meta WhatsApp Cloud API: verifying, parsing and replying."""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass(slots=True)
class InboundMessage:
    external_message_id: str
    from_number: str
    sender_name: str | None
    text: str
    timestamp: datetime
    phone_number_id: str | None = None
    reply_to_id: str | None = None


def verify_subscription(
    mode: str | None, token: str | None, challenge: str | None, expected_token: str
) -> str:
    """Meta's GET handshake. Returns the challenge, or raises."""
    if not expected_token:
        raise PermissionError("WHATSAPP_VERIFY_TOKEN is not configured")
    if mode != "subscribe" or not token or not hmac.compare_digest(token, expected_token):
        raise PermissionError("Webhook verification rejected")
    return challenge or ""


def verify_signature(raw_body: bytes, header: str | None, app_secret: str) -> bool:
    """Checks Meta's X-Hub-Signature-256 over the exact bytes received.

    Re-serialising the parsed JSON produces a different digest, so this must
    run on the raw body.
    """
    if not app_secret:
        # Unset means the check is deliberately off (local development).
        return True
    if not header or not header.startswith("sha256="):
        return False

    expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.removeprefix("sha256="))


def _items(container: object, key: str) -> list[dict]:
    """A list of dicts under `key`, whatever nonsense actually arrived.

    This endpoint is public: the body is attacker-controlled, and a malformed
    one must be ignored, not crash the webhook into a retry loop.
    """
    if not isinstance(container, dict):
        return []
    value = container.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def parse_webhook(payload: dict) -> list[InboundMessage]:
    """Pulls the text messages out of a webhook body, ignoring the rest.

    Status callbacks, reactions and unsupported media are not errors — they
    are simply not questions.
    """
    messages: list[InboundMessage] = []

    for entry in _items(payload, "entry"):
        for change in _items(entry, "changes"):
            value = change.get("value")
            if not isinstance(value, dict):
                continue

            contacts = {
                contact.get("wa_id"): (contact.get("profile") or {}).get("name")
                for contact in _items(value, "contacts")
            }
            metadata = value.get("metadata")
            phone_number_id = (
                metadata.get("phone_number_id") if isinstance(metadata, dict) else None
            )

            for raw in _items(value, "messages"):
                text = _extract_text(raw)
                if not text:
                    continue

                messages.append(
                    InboundMessage(
                        external_message_id=raw.get("id", ""),
                        from_number=raw.get("from", ""),
                        sender_name=contacts.get(raw.get("from")),
                        text=text,
                        timestamp=_parse_timestamp(raw.get("timestamp")),
                        phone_number_id=phone_number_id,
                        reply_to_id=(raw.get("context") or {}).get("id"),
                    )
                )
    return messages


def _extract_text(raw: dict) -> str:
    return (
        (raw.get("text") or {}).get("body")
        or (raw.get("image") or {}).get("caption")
        or (raw.get("video") or {}).get("caption")
        or (raw.get("button") or {}).get("text")
        or ""
    ).strip()


def _parse_timestamp(value: str | None) -> datetime:
    try:
        return datetime.fromtimestamp(int(value or 0), tz=timezone.utc)
    except (TypeError, ValueError):
        return datetime.now(tz=timezone.utc)


class WhatsAppClient:
    """Sending side of the Cloud API."""

    def __init__(
        self, access_token: str, phone_number_id: str, api_version: str = "v21.0"
    ) -> None:
        self.access_token = access_token
        self.phone_number_id = phone_number_id
        self.api_version = api_version

    @property
    def configured(self) -> bool:
        return bool(self.access_token and self.phone_number_id)

    async def send_text(self, to: str, body: str) -> None:
        if not self.configured:
            # Local mode: log what would have been sent instead of failing.
            logger.warning("whatsapp_not_configured", to=to, preview=body[:120])
            return

        url = (
            f"https://graph.facebook.com/{self.api_version}/"
            f"{self.phone_number_id}/messages"
        )
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {self.access_token}"},
                json={
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": to,
                    "type": "text",
                    "text": {"preview_url": False, "body": body},
                },
            )
            if response.status_code >= 400:
                # 401 while testing almost always means the token expired.
                logger.error(
                    "whatsapp_send_failed", status=response.status_code, body=response.text[:300]
                )
                response.raise_for_status()
