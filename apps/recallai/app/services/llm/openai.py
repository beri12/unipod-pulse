"""Cloud models through the OpenAI-compatible chat completions API."""

from __future__ import annotations

import httpx

from app.services.llm.base import ContextChunk, LLMAnswer
from app.services.llm.parsing import parse_llm_json


class OpenAILLMProvider:
    name = "openai"

    def __init__(self, api_key: str, model: str, base_url: str, timeout: float = 120.0) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def generate(
        self, *, system_prompt: str, user_prompt: str, context: list[ContextChunk]
    ) -> LLMAnswer:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            payload = response.json()

        content = payload["choices"][0]["message"]["content"]
        return parse_llm_json(content, self.model)
