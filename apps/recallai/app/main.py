"""RecallAI — an AI memory layer for a group."""

from __future__ import annotations

import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import ask, groups, health, knowledge, whatsapp
from app.core.config import get_settings
from app.core.errors import (
    RecallError,
    http_error_handler,
    recall_error_handler,
    unhandled_error_handler,
)
from app.core.logging import configure_logging, get_logger, set_request_id

DESCRIPTION = """
RecallAI turns everything a group already said — chat messages, meeting
recordings, transcripts and documents — into a memory it can be asked about.

Answers come only from the group's own knowledge, always with the sources
that support them, and a group can never see another group's information.
"""


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, json_logs=settings.is_production)
    logger = get_logger("recallai")

    app = FastAPI(
        title=settings.app_name,
        description=DESCRIPTION,
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = set_request_id(request.headers.get("x-request-id"))
        started = time.perf_counter()

        response = await call_next(request)

        response.headers["x-request-id"] = request_id
        logger.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )
        return response

    app.add_exception_handler(RecallError, recall_error_handler)
    app.add_exception_handler(HTTPException, http_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    app.include_router(health.router)
    app.include_router(ask.router)
    app.include_router(knowledge.router)
    app.include_router(groups.router)
    app.include_router(whatsapp.router)

    if settings.enable_debug_endpoints and not settings.is_production:
        from app.api.routes import debug

        app.include_router(debug.router)
        logger.warning("debug_endpoints_enabled")

    logger.info(
        "recallai_started",
        env=settings.app_env,
        llm=settings.llm_provider,
        embeddings=settings.embedding_provider,
        transcription=settings.transcription_provider,
    )
    return app


app = create_app()
