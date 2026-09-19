"""Offline language model: extractive, never generative.

It quotes the retrieved context instead of writing prose, which keeps the app
demonstrable and every test deterministic with no model server. It answers
only when the question and a sentence genuinely overlap, so "I could not find
it" still happens for the right reasons.

Not for production: real answers need Ollama or a cloud model.
"""

from __future__ import annotations

import re

from app.services.llm.base import ContextChunk, LLMAnswer

_TOKEN = re.compile(r"\w+", re.UNICODE)
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")

#: Words that say nothing about what is being asked.
_STOPWORDS = frozenset(
    """a an the is are was were be been being of to in on at for from by with and or
    when what where who whom which why how did do does done has have had will would
    shall should can could may might must it its this that these those i you he she
    we they me him her us them my your his our their
    le la les un une des du de et ou est sont etait etaient a au aux ce cet cette ces
    quand quoi qui que quel quelle ou comment pourquoi pour dans sur avec par
    il elle nous vous ils elles je tu mon ton son notre votre leur
    """.split()
)

#: A sentence must share at least this much with the question. Short
#: questions ("When is the deployment?") carry a single content word, so a
#: fixed threshold of two would make them unanswerable.
def _required_overlap(wanted: set[str]) -> int:
    return 1 if len(wanted) <= 1 else 2


def _tokens(text: str) -> set[str]:
    return {token for token in _TOKEN.findall(text.lower()) if token not in _STOPWORDS}


class FakeLLMProvider:
    name = "fake"
    model = "fake-extractive"

    async def generate(
        self, *, system_prompt: str, user_prompt: str, context: list[ContextChunk]
    ) -> LLMAnswer:
        question = _extract_question(user_prompt)
        wanted = _tokens(question)
        if not wanted or not context:
            return LLMAnswer(answer=None, confidence="unsupported", model=self.model)

        best_score = 0
        best_sentence = ""
        best_chunk: ContextChunk | None = None

        for chunk in context:
            for sentence in _SENTENCE.split(chunk.content):
                sentence = sentence.strip()
                if not sentence:
                    continue
                score = len(wanted & _tokens(sentence))
                # >= not >: on a tie the LATER sentence wins. Chunks are
                # chronological, and "let's move it to Thursday" supersedes
                # "originally planned for Wednesday" — answering with the
                # superseded fact is worse than not answering.
                if score >= best_score and score > 0:
                    best_score, best_sentence, best_chunk = score, sentence, chunk

        if best_score < _required_overlap(wanted) or best_chunk is None:
            return LLMAnswer(answer=None, confidence="unsupported", model=self.model)

        return LLMAnswer(
            answer=best_sentence,
            confidence="supported",
            cited_chunk_ids=[best_chunk.chunk_id],
            model=self.model,
        )


def _extract_question(user_prompt: str) -> str:
    """Pulls the question back out of the rendered prompt."""
    marker = "Question"
    index = user_prompt.rfind(marker)
    if index < 0:
        return user_prompt
    tail = user_prompt[index:]
    lines = [line.strip() for line in tail.splitlines()[1:] if line.strip()]
    return lines[0] if lines else user_prompt
