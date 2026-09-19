"""Background work.

Transcribing an hour of audio cannot happen inside an HTTP request, so the
slow paths are handed to a worker and the request returns immediately.
"""

from __future__ import annotations

from functools import lru_cache

from redis import Redis
from rq import Queue

from app.core.config import get_settings

QUEUE_NAME = "recallai"


@lru_cache
def get_redis() -> Redis:
    return Redis.from_url(get_settings().redis_url)


@lru_cache
def get_queue() -> Queue:
    # Transcription of a long meeting can genuinely take many minutes.
    return Queue(QUEUE_NAME, connection=get_redis(), default_timeout=3600)


def enqueue(func, *args, **kwargs):
    return get_queue().enqueue(func, *args, **kwargs)
