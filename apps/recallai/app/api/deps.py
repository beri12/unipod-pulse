"""Dependency wiring — services are built here, never inside routes."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.database import get_session
from app.db.repositories.chunks import PostgresChunkRepository
from app.services.embeddings.base import EmbeddingProvider
from app.services.embeddings.factory import get_embedding_provider
from app.services.ingestion.service import IngestionService
from app.services.language.detector import language_service
from app.services.llm.base import LLMProvider
from app.services.llm.factory import get_llm_provider
from app.services.messaging.whatsapp import WhatsAppClient
from app.services.rag.service import RAGService
from app.services.storage.local import LocalStorageProvider
from app.services.transcription.base import TranscriptionProvider
from app.services.transcription.factory import get_transcription_provider

SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


@lru_cache
def get_storage_provider() -> LocalStorageProvider:
    return LocalStorageProvider(get_settings().storage_path)


@lru_cache
def get_whatsapp_client() -> WhatsAppClient:
    settings = get_settings()
    return WhatsAppClient(
        access_token=settings.whatsapp_access_token,
        phone_number_id=settings.whatsapp_phone_number_id,
        api_version=settings.whatsapp_api_version,
    )


def get_rag_service(
    session: SessionDep,
    settings: SettingsDep,
    embeddings: Annotated[EmbeddingProvider, Depends(get_embedding_provider)],
    llm: Annotated[LLMProvider, Depends(get_llm_provider)],
) -> RAGService:
    return RAGService(
        settings=settings,
        chunks=PostgresChunkRepository(session),
        embeddings=embeddings,
        llm=llm,
        language=language_service,
    )


def get_ingestion_service(
    session: SessionDep,
    settings: SettingsDep,
    embeddings: Annotated[EmbeddingProvider, Depends(get_embedding_provider)],
    transcription: Annotated[TranscriptionProvider, Depends(get_transcription_provider)],
) -> IngestionService:
    return IngestionService(
        session=session,
        settings=settings,
        embeddings=embeddings,
        transcription=transcription,
        storage=get_storage_provider(),
    )


RAGDep = Annotated[RAGService, Depends(get_rag_service)]
IngestionDep = Annotated[IngestionService, Depends(get_ingestion_service)]
WhatsAppDep = Annotated[WhatsAppClient, Depends(get_whatsapp_client)]
