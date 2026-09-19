"""Structured logging with a request id on every line."""

import logging
import uuid
from contextvars import ContextVar

import structlog

_request_id: ContextVar[str] = ContextVar("request_id", default="-")

#: Values that must never reach the logs, whatever key they arrive under.
SECRET_KEYS = frozenset(
    {
        "whatsapp_access_token",
        "openai_api_key",
        "database_url",
        "redis_url",
        "password",
        "token",
        "secret",
        "authorization",
    }
)


def set_request_id(value: str | None = None) -> str:
    request_id = value or uuid.uuid4().hex[:12]
    _request_id.set(request_id)
    return request_id


def get_request_id() -> str:
    return _request_id.get()


def _add_request_id(_logger, _name, event_dict):
    event_dict["request_id"] = get_request_id()
    return event_dict


def _redact(_logger, _name, event_dict):
    """Belt and braces: a secret passed by mistake is masked, not printed."""
    for key in list(event_dict):
        if key.lower() in SECRET_KEYS and event_dict[key]:
            event_dict[key] = "***"
    return event_dict


def configure_logging(level: str = "INFO", json_logs: bool = False) -> None:
    logging.basicConfig(format="%(message)s", level=getattr(logging, level.upper(), logging.INFO))

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            _add_request_id,
            _redact,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer()
            if json_logs
            else structlog.dev.ConsoleRenderer(colors=False),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "recallai"):
    return structlog.get_logger(name)
