from app.services.language.detector import LanguageService

service = LanguageService()


class TestDetection:
    def test_detects_english(self):
        assert service.detect("When was the deployment moved?") == "en"

    def test_detects_french(self):
        assert service.detect("Quand le déploiement a-t-il été déplacé ?") == "fr"

    def test_detects_french_without_accents(self):
        assert service.detect("Quand est prevu le deploiement pour la reunion ?") == "fr"

    def test_unknown_for_gibberish(self):
        assert service.detect("zxcv qwer asdf") == "unknown"

    def test_unknown_for_a_bare_word(self):
        # One word carries no function words to judge by; guessing would be
        # worse than admitting it.
        assert service.detect("Thursday") == "unknown"

    def test_unknown_for_empty(self):
        assert service.detect("") == "unknown"
        assert service.detect("   ") == "unknown"


class TestReplyLanguage:
    def test_answers_in_the_question_language(self):
        assert service.reply_language("When is the meeting?") == "en"
        assert service.reply_language("Quand est la réunion ?") == "fr"

    def test_falls_back_rather_than_returning_unknown(self):
        # A reply has to be in some language.
        assert service.reply_language("zxcv qwer") == "en"
        assert service.reply_language("zxcv qwer", fallback="fr") == "fr"

    def test_confidence_is_reported(self):
        assert service.detect_detailed("Quand est le déploiement ?").confidence > 0
        assert service.detect_detailed("zxcv").confidence == 0.0
