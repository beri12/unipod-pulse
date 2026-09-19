"""Deterministic language detection for the supported languages.

Deliberately not a model: detection runs on every question, must never add
latency or a dependency, and must give the same answer every time. Scoring is
by function words, which are the part of a sentence a writer cannot avoid.

Adding a language means adding its marker set — nothing else changes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

SUPPORTED = ("en", "fr")
UNKNOWN = "unknown"

_TOKEN = re.compile(r"[\w'’-]+", re.UNICODE)

_MARKERS: dict[str, frozenset[str]] = {
    "en": frozenset(
        """the a an is are was were do does did when where who what which why how
        will would can could should have has had been being of to in on at for from
        by with and or not this that these those it its there here about deployment
        meeting moved scheduled""".split()
    ),
    "fr": frozenset(
        """le la les un une des du de au aux est sont etait etaient été quand où ou
        qui que quoi quel quelle quels quelles pourquoi comment combien
        dans sur avec par pour sans nous vous ils elles je tu il elle
        prevu prévu deploiement déploiement reunion réunion deplace déplacé
        c'est n'est d'un d'une qu'il qu'elle""".split()
    ),
}

#: Characters that all but settle it on their own.
_FRENCH_CHARS = re.compile(r"[àâçéèêëîïôûùüÿœ]", re.IGNORECASE)


@dataclass(slots=True)
class Detection:
    language: str
    confidence: float


class LanguageService:
    """Detects the language of a question."""

    def detect(self, text: str) -> str:
        return self.detect_detailed(text).language

    def detect_detailed(self, text: str) -> Detection:
        tokens = [token.lower() for token in _TOKEN.findall(text or "")]
        if not tokens:
            return Detection(UNKNOWN, 0.0)

        scores = {
            language: sum(1 for token in tokens if token in markers)
            for language, markers in _MARKERS.items()
        }

        # Accented characters are strong evidence for French and cost nothing
        # to check, which rescues short questions with few function words.
        accents = len(_FRENCH_CHARS.findall(text))
        if accents:
            scores["fr"] += min(accents, 3)

        best = max(scores, key=lambda language: scores[language])
        best_score = scores[best]
        if best_score == 0:
            return Detection(UNKNOWN, 0.0)

        runner_up = max(score for language, score in scores.items() if language != best)
        if best_score == runner_up:
            # A tie means the markers were shared words; do not guess.
            return Detection(UNKNOWN, 0.0)

        return Detection(best, round(best_score / (best_score + runner_up), 3))

    def reply_language(self, text: str, fallback: str = "en") -> str:
        """The language to answer in — never `unknown`."""
        language = self.detect(text)
        return language if language in SUPPORTED else fallback


language_service = LanguageService()
