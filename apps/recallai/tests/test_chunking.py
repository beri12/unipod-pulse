from datetime import datetime, timezone

from app.services.chunking.chunker import (
    MessageInput,
    chunk_document,
    chunk_messages,
    chunk_transcript,
    format_timestamp,
)
from app.services.transcription.base import Segment


class TestDocumentChunking:
    def test_short_document_is_one_chunk(self):
        chunks = chunk_document("Deployment moved to Thursday.", 1200, 200)
        assert len(chunks) == 1
        assert chunks[0].index == 0

    def test_empty_document_yields_nothing(self):
        assert chunk_document("", 1200, 200) == []
        assert chunk_document("   \n\n  ", 1200, 200) == []

    def test_long_document_is_split_and_numbered(self):
        text = "\n\n".join(f"Paragraph {index}. " + "word " * 40 for index in range(10))
        chunks = chunk_document(text, 500, 50)

        assert len(chunks) > 1
        assert [chunk.index for chunk in chunks] == list(range(len(chunks)))

    def test_overlap_carries_whole_lines_only(self):
        lines = [f"Line {index} with enough text to matter here." for index in range(20)]
        chunks = chunk_document("\n".join(lines), 200, 90)

        assert len(chunks) > 1
        for chunk in chunks:
            for line in chunk.content.split("\n"):
                if line.strip():
                    # A fragment of a line would be a sentence cut in half.
                    assert line.strip() in lines

    def test_a_line_longer_than_a_chunk_is_cut(self):
        chunks = chunk_document("x" * 1000, 300, 0)
        assert len(chunks) > 1
        assert all(len(chunk.content) <= 300 for chunk in chunks)


class TestMessageChunking:
    def _message(self, sender: str, text: str, minute: int) -> MessageInput:
        return MessageInput(
            external_id=f"wamid.{minute}",
            sender=sender,
            text=text,
            timestamp=datetime(2026, 9, 18, 10, minute, tzinfo=timezone.utc),
        )

    def test_keeps_sender_and_timestamp_in_the_text(self):
        chunks = chunk_messages([self._message("Alice", "Let's move it to Thursday.", 0)])

        assert "Alice:" in chunks[0].content
        assert "2026-09-18 10:00" in chunks[0].content

    def test_groups_a_conversation_into_windows(self):
        messages = [self._message("Alice", f"message {index}", index) for index in range(14)]
        chunks = chunk_messages(messages, window=6)

        # Whole conversations in one chunk bury the answer; one message per
        # chunk loses the thread.
        assert len(chunks) == 3
        assert chunks[0].metadata["senders"] == ["Alice"]
        assert len(chunks[0].metadata["message_ids"]) == 6

    def test_records_the_window_boundaries(self):
        chunks = chunk_messages([self._message("Bob", "hi", 0), self._message("Amina", "hello", 5)])

        assert chunks[0].metadata["started_at"].startswith("2026-09-18T10:00")
        assert chunks[0].metadata["ended_at"].startswith("2026-09-18T10:05")
        assert chunks[0].metadata["senders"] == ["Amina", "Bob"]

    def test_keeps_reply_context(self):
        message = self._message("Bob", "Thursday works for me.", 1)
        message.reply_to_text = "Let's move it to Thursday."
        chunks = chunk_messages([message])

        assert "replying to" in chunks[0].content

    def test_no_messages_yields_nothing(self):
        assert chunk_messages([]) == []


class TestTranscriptChunking:
    def test_formats_timestamps(self):
        assert format_timestamp(0) == "00:00:00"
        assert format_timestamp(2061) == "00:34:21"
        assert format_timestamp(3661) == "01:01:01"

    def test_keeps_timestamps_and_speakers(self):
        segments = [
            Segment(2061, 2075, "We confirmed deployment will happen Thursday.", "Alice"),
            Segment(2075, 2090, "Thursday works for me.", "Bob"),
        ]
        chunks = chunk_transcript(segments, 1200)

        assert "00:34:21" in chunks[0].content
        assert "Alice:" in chunks[0].content
        # The metadata is what a citation reads to say "00:34:21".
        assert chunks[0].metadata["timestamp"] == "00:34:21"
        assert chunks[0].metadata["start_time"] == 2061
        assert chunks[0].metadata["speakers"] == ["Alice", "Bob"]

    def test_splits_long_recordings_by_size(self):
        segments = [Segment(i * 10, i * 10 + 10, "word " * 40) for i in range(40)]
        chunks = chunk_transcript(segments, 600)

        assert len(chunks) > 1
        assert chunks[0].metadata["start_time"] == 0
        assert chunks[1].metadata["start_time"] > chunks[0].metadata["end_time"] - 1

    def test_no_segments_yields_nothing(self):
        assert chunk_transcript([], 1200) == []
