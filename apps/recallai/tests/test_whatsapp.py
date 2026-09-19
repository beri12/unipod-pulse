import hashlib
import hmac
import json

import pytest

from app.api.routes.whatsapp import _as_question
from app.services.messaging.whatsapp import (
    parse_webhook,
    verify_signature,
    verify_subscription,
)

SECRET = "app-secret"

PAYLOAD = {
    "object": "whatsapp_business_account",
    "entry": [
        {
            "changes": [
                {
                    "field": "messages",
                    "value": {
                        "metadata": {"phone_number_id": "111222"},
                        "contacts": [{"wa_id": "212600000000", "profile": {"name": "Alice"}}],
                        "messages": [
                            {
                                "id": "wamid.ABC",
                                "from": "212600000000",
                                "timestamp": "1789000000",
                                "type": "text",
                                "text": {"body": "When is the deployment?"},
                            }
                        ],
                    },
                }
            ]
        }
    ],
}


def sign(body: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class TestSubscriptionHandshake:
    def test_echoes_the_challenge(self):
        assert verify_subscription("subscribe", "tok", "CHAL", "tok") == "CHAL"

    def test_rejects_a_wrong_token(self):
        with pytest.raises(PermissionError):
            verify_subscription("subscribe", "wrong", "CHAL", "tok")

    def test_rejects_another_mode(self):
        with pytest.raises(PermissionError):
            verify_subscription("unsubscribe", "tok", "CHAL", "tok")

    def test_refuses_when_no_token_is_configured(self):
        with pytest.raises(PermissionError):
            verify_subscription("subscribe", "", "CHAL", "")


class TestSignature:
    def test_accepts_a_correct_signature(self):
        body = json.dumps(PAYLOAD).encode()
        assert verify_signature(body, sign(body), SECRET) is True

    def test_rejects_a_wrong_secret(self):
        body = json.dumps(PAYLOAD).encode()
        assert verify_signature(body, sign(body, "other"), SECRET) is False

    def test_rejects_a_body_changed_after_signing(self):
        signature = sign(json.dumps(PAYLOAD).encode())
        assert verify_signature(b'{"evil": true}', signature, SECRET) is False

    def test_rejects_missing_or_malformed_headers(self):
        body = json.dumps(PAYLOAD).encode()
        assert verify_signature(body, None, SECRET) is False
        assert verify_signature(body, "sha1=abc", SECRET) is False

    def test_no_configured_secret_means_the_check_is_off(self):
        assert verify_signature(b"{}", None, "") is True


class TestParsing:
    def test_reads_a_text_message(self):
        message = parse_webhook(PAYLOAD)[0]

        assert message.external_message_id == "wamid.ABC"
        assert message.sender_name == "Alice"
        assert message.text == "When is the deployment?"
        assert message.phone_number_id == "111222"

    def test_ignores_status_callbacks(self):
        assert parse_webhook({"entry": [{"changes": [{"value": {"statuses": [{"id": "x"}]}}]}]}) == []

    def test_ignores_an_unparsable_body(self):
        assert parse_webhook({}) == []
        assert parse_webhook({"entry": "not-a-list"}) == []

    def test_reads_an_image_caption(self):
        payload = json.loads(json.dumps(PAYLOAD))
        payload["entry"][0]["changes"][0]["value"]["messages"][0] = {
            "id": "wamid.IMG",
            "from": "212600000000",
            "timestamp": "1789000000",
            "type": "image",
            "image": {"caption": "Is this the final plan?"},
        }
        assert parse_webhook(payload)[0].text == "Is this the final plan?"


class TestWhatCountsAsAQuestion:
    def test_a_question_mark_is_enough(self):
        assert _as_question("When is the deployment?") == "When is the deployment?"

    def test_an_arabic_question_mark_counts(self):
        assert _as_question("متى النشر؟") is not None

    def test_a_mention_counts(self):
        assert _as_question("@RecallAI when is the meeting") == "when is the meeting"

    def test_a_statement_is_only_stored(self):
        # The bot must not answer every message in a busy group.
        assert _as_question("Thursday works for me.") is None

    def test_search_command_carries_its_query(self):
        assert _as_question("/search deployment date") == "deployment date"

    def test_bare_commands_are_handled(self):
        assert _as_question("/help") is not None
        assert _as_question("/about") is not None
