"""Local models through Ollama (Qwen, Llama, ...)."""

from __future__ import annotations

import httpx

from app.services.llm.base import ContextChunk, LLMAnswer
from app.services.llm.parsing import parse_llm_json


class OllamaLLMProvider:
    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout: float = 300.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._timeout = timeout

    async def generate(
        self, *, system_prompt: str, user_prompt: str, context: list[ContextChunk]
    ) -> LLMAnswer:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "stream": False,
                    "format": "json",
                    # Low temperature: this is retrieval, not creative writing.
                    "options": {"temperature": 0.1},
                },
            )
            response.raise_for_status()
            payload = response.json()

        return parse_llm_json(payload.get("message", {}).get("content", ""), self.model)
