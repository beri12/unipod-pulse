"""Application settings, read once from the environment."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # ── Application ───────────────────────────────────────────────────────────
    app_env: Literal["development", "test", "production"] = "development"
    app_name: str = "RecallAI"
    app_port: int = 8000
    log_level: str = "INFO"
    cors_origins: str = ""

    # ── Storage ───────────────────────────────────────────────────────────────
    database_url: str = "postgresql+psycopg://recallai:recallai@postgres:5432/recallai"
    redis_url: str = "redis://redis:6379/0"
    storage_provider: Literal["local"] = "local"
    storage_path: str = "/data/uploads"

    # ── WhatsApp Cloud API ────────────────────────────────────────────────────
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_verify_token: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_api_version: str = "v21.0"

    # ── Language models ───────────────────────────────────────────────────────
    # "fake" keeps the whole app runnable, and every test deterministic,
    # without a model server or an API key.
    llm_provider: Literal["ollama", "openai", "fake"] = "fake"
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "qwen2.5"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

    embedding_provider: Literal["ollama", "openai", "fake"] = "fake"
    embedding_model: str = "nomic-embed-text"
    # The pgvector column is fixed by the migration: changing this needs a new
    # migration and a re-embed of every chunk.
    embedding_dimensions: int = 768

    transcription_provider: Literal["whisper_local", "openai", "fake"] = "fake"
    whisper_model: str = "base"

    # ── Retrieval ─────────────────────────────────────────────────────────────
    chunk_size: int = 1200
    chunk_overlap: int = 200
    retrieval_top_k: int = 8
    retrieval_candidates: int = 40
    # Below this the answer is treated as unsupported and refused.
    min_answer_confidence: float = 0.5

    # ── Limits and debugging ──────────────────────────────────────────────────
    max_upload_mb: int = 50
    enable_debug_endpoints: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Cached so every caller sees one consistent configuration."""
    return Settings()
