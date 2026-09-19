from app.db.repositories.chunks import RetrievedChunk
from app.services.rag.citations import build_citations, format_for_chat


def chunk(chunk_id: str, source_type: str, title: str, score: float = 0.9, **kwargs):
    return RetrievedChunk(
        chunk_id=chunk_id,
        source_id=f"source-{chunk_id}",
        content="...",
        score=score,
        source_type=source_type,
        source_title=title,
        **kwargs,
    )


MESSAGE = chunk(
    "c1", "MESSAGE", "WhatsApp message",
    occurred_at="2026-09-18T10:00:00", chunk_metadata={"senders": ["Alice"]},
)
MEETING = chunk("c2", "MEETING", "Weekly Team Meeting", 0.8, chunk_metadata={"timestamp": "00:34:21"})
DOCUMENT = chunk(
    "c3", "DOCUMENT", "deployment-plan.pdf", 0.7,
    chunk_metadata={"page": 4}, source_metadata={"filename": "deployment-plan.pdf"},
)


class TestTheModelCannotInventSources:
    def test_unknown_chunk_ids_are_dropped(self):
        citations = build_citations([MESSAGE, MEETING], ["c1", "chunk-that-never-existed"])

        assert [citation.chunk_id for citation in citations] == ["c1"]

    def test_every_invented_id_is_dropped(self):
        citations = build_citations([MESSAGE], ["made-up-1", "made-up-2"])

        # Nothing valid was cited, so the best retrieved chunk is cited
        # instead — a real row the reader can check, never an invented one.
        assert [citation.chunk_id for citation in citations] == ["c1"]

    def test_citing_nothing_falls_back_to_best_retrieved(self):
        citations = build_citations([MESSAGE, MEETING, DOCUMENT], [])

        assert [citation.chunk_id for citation in citations] == ["c1", "c2", "c3"]

    def test_duplicate_citations_are_collapsed(self):
        citations = build_citations([MESSAGE, MEETING], ["c1", "c1", "c2"])

        assert [citation.chunk_id for citation in citations] == ["c1", "c2"]

    def test_a_chat_reply_is_not_flooded_with_sources(self):
        many = [chunk(f"c{index}", "MESSAGE", "WhatsApp message") for index in range(10)]
        assert len(build_citations(many, [c.chunk_id for c in many])) == 3


class TestLabels:
    def test_message_names_the_sender_and_date(self):
        label = build_citations([MESSAGE], ["c1"])[0].label
        assert "Alice" in label and "2026-09-18" in label

    def test_meeting_names_the_timestamp(self):
        citation = build_citations([MEETING], ["c2"])[0]
        assert citation.label == "Weekly Team Meeting — 00:34:21"
        assert citation.timestamp == "00:34:21"

    def test_document_names_the_page(self):
        citation = build_citations([DOCUMENT], ["c3"])[0]
        assert citation.label == "deployment-plan.pdf — page 4"
        assert citation.page == 4

    def test_as_dict_omits_empty_fields(self):
        assert "page" not in build_citations([MESSAGE], ["c1"])[0].as_dict()


class TestChatFormatting:
    def test_sources_are_listed_under_the_answer(self):
        text = format_for_chat("Thursday.", build_citations([MESSAGE, MEETING], ["c1", "c2"]))

        assert text.startswith("Thursday.")
        assert "Sources:" in text
        assert "• Weekly Team Meeting — 00:34:21" in text

    def test_no_sources_means_no_empty_heading(self):
        assert format_for_chat("Thursday.", []) == "Thursday."
