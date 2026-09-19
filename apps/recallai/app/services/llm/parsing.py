"""Turning whatever a model returns into an LLMAnswer."""

from __future__ import annotations

import json

from app.services.llm.base import LLMAnswer


def parse_llm_json(raw: str, model: str) -> LLMAnswer:
    """Reads the model's JSON, tolerating prose or fences around it.

    A model that cannot be parsed is treated as unable to answer: inventing a
    reply out of a broken response is exactly what must not happen.
    """
    payload = _extract_json_object(raw)
    if payload is None:
        return LLMAnswer(answer=None, confidence="unsupported", model=model)

    answer = payload.get("answer")
    if isinstance(answer, str):
        answer = answer.strip() or None
    elif answer is not None:
        answer = str(answer)

    chunk_ids = payload.get("chunk_ids") or payload.get("citations") or []
    if not isinstance(chunk_ids, list):
        chunk_ids = []

    confidence = str(payload.get("confidence", "unsupported")).lower()
    if confidence not in {"supported", "unsupported"}:
        confidence = "supported" if answer else "unsupported"
    if answer is None:
        confidence = "unsupported"

    return LLMAnswer(
        answer=answer,
        confidence=confidence,
        cited_chunk_ids=[str(value) for value in chunk_ids],
        model=model,
    )


def _extract_json_object(raw: str) -> dict | None:
    text = (raw or "").strip()
    if not text:
        return None

    # Strip a ```json fence if there is one.
    if text.startswith("```"):
        text = text.split("```")[1] if "```" in text[3:] else text
        text = text.removeprefix("json").strip()

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    # Fall back to the first {...} block in a chatty response.
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None
