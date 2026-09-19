"""Liveness and readiness.

Readiness reports unhealthy when a dependency the product cannot work without
is down, so an orchestrator does not send traffic to a broken instance.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.api.deps import SessionDep, SettingsDep
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse, summary="Liveness")
async def health() -> HealthResponse:
    return HealthResponse(status="ok", checks={})


@router.get("/api/health", response_model=HealthResponse, summary="Readiness")
async def readiness(session: SessionDep, settings: SettingsDep, response: Response) -> HealthResponse:
    checks: dict[str, str] = {}

    try:
        await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as error:  # noqa: BLE001 - reported, not raised
        checks["database"] = f"error: {type(error).__name__}"

    try:
        from redis.asyncio import from_url

        client = from_url(settings.redis_url)
        await client.ping()
        await client.aclose()
        checks["redis"] = "ok"
    except Exception as error:  # noqa: BLE001
        checks["redis"] = f"error: {type(error).__name__}"

    if settings.llm_provider == "ollama" or settings.embedding_provider == "ollama":
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                result = await client.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags")
                result.raise_for_status()
            checks["ollama"] = "ok"
        except Exception as error:  # noqa: BLE001
            checks["ollama"] = f"error: {type(error).__name__}"

    checks["llm_provider"] = settings.llm_provider
    checks["embedding_provider"] = settings.embedding_provider

    critical = [key for key in ("database", "redis", "ollama") if checks.get(key, "ok") != "ok"]
    if critical:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthResponse(status="degraded", checks=checks)

    return HealthResponse(status="ok", checks=checks)
