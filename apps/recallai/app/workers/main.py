"""Worker entrypoint: `python -m app.workers.main`."""

from __future__ import annotations

from redis import Redis
from rq import Worker

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.workers.queue import QUEUE_NAME


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level, json_logs=settings.is_production)
    get_logger("recallai.worker").info("worker_started", queue=QUEUE_NAME)

    Worker([QUEUE_NAME], connection=Redis.from_url(settings.redis_url)).work(with_scheduler=True)


if __name__ == "__main__":
    main()
