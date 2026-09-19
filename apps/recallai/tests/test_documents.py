import io

import pytest

from app.services.documents.parsers import UnsupportedDocument, detect_kind, parse_document


class TestKindDetection:
    @pytest.mark.parametrize(
        ("filename", "mime", "expected"),
        [
            ("plan.pdf", "application/pdf", "pdf"),
            ("plan.PDF", None, "pdf"),
            ("notes.txt", "text/plain", "txt"),
            ("readme.md", None, "md"),
            (
                "spec.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "docx",
            ),
            ("notes.txt", "text/plain; charset=utf-8", "txt"),
        ],
    )
    def test_supported_kinds(self, filename, mime, expected):
        assert detect_kind(filename, mime) == expected

    def test_unsupported_is_rejected_by_name_and_type(self):
        with pytest.raises(UnsupportedDocument):
            detect_kind("payload.exe", "application/x-msdownload")


class TestParsing:
    def test_plain_text(self):
        parsed = parse_document(b"Deployment moved to Thursday.", "notes.txt", "text/plain")

        assert parsed.text == "Deployment moved to Thursday."
        assert parsed.pages[0].number == 1

    def test_invalid_utf8_does_not_raise(self):
        parsed = parse_document(b"caf\xff\xfe", "notes.txt", "text/plain")
        assert parsed.text

    def test_empty_file_yields_no_pages(self):
        assert parse_document(b"   ", "notes.txt", "text/plain").pages == []

    def test_docx_text_and_tables(self):
        docx = pytest.importorskip("docx")

        document = docx.Document()
        document.add_paragraph("The deployment was moved to Thursday.")
        table = document.add_table(rows=1, cols=2)
        table.rows[0].cells[0].text = "Owner"
        table.rows[0].cells[1].text = "Alice"

        buffer = io.BytesIO()
        document.save(buffer)

        parsed = parse_document(buffer.getvalue(), "plan.docx")

        assert "moved to Thursday" in parsed.text
        # Tables often hold the fact people later ask about.
        assert "Owner | Alice" in parsed.text

    def test_pdf_keeps_page_numbers(self):
        pypdf = pytest.importorskip("pypdf")

        writer = pypdf.PdfWriter()
        writer.add_blank_page(width=200, height=200)
        writer.add_blank_page(width=200, height=200)
        buffer = io.BytesIO()
        writer.write(buffer)

        parsed = parse_document(buffer.getvalue(), "plan.pdf", "application/pdf")

        # Blank pages carry no text, but the count is still read.
        assert parsed.metadata["page_count"] == 2
