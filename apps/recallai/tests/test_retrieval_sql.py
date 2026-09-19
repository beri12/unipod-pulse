"""The isolation guarantee, checked at the SQL level."""

import inspect
import re

from app.db.repositories import chunks as chunks_module
from app.db.repositories.chunks import _SEARCH_SQL, PostgresChunkRepository, _vector_literal

SQL = _SEARCH_SQL.text


class TestGroupScoping:
    def test_every_table_touched_is_filtered_by_group(self):
        # Two CTEs plus the chunk and source joins in the final select.
        assert SQL.count(":group_id") == 4

    def test_no_select_from_chunks_without_a_group_filter(self):
        for statement in re.findall(r"FROM knowledge_chunks.*?(?=\)|ORDER BY|$)", SQL, re.S):
            assert "group_id = :group_id" in statement

    def test_sources_are_joined_only_within_the_group(self):
        assert "s.group_id = :group_id" in SQL

    def test_group_id_is_a_required_keyword_argument(self):
        signature = inspect.signature(PostgresChunkRepository.search)
        parameter = signature.parameters["group_id"]

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
        assert parameter.default is inspect.Parameter.empty


class TestBindings:
    def test_values_are_bound_never_interpolated(self):
        # String interpolation here would be an injection hole.
        assert "%s" not in SQL
        assert "format(" not in SQL
        assert '" +' not in inspect.getsource(PostgresChunkRepository.search)

    def test_vector_literal_is_numeric_only(self):
        literal = _vector_literal([0.5, -0.25, 0.0])

        assert literal == "[0.50000000,-0.25000000,0.00000000]"
        assert re.fullmatch(r"\[[-0-9.,]+\]", literal)


class TestHybridSearch:
    def test_combines_vector_and_keyword_signals(self):
        assert "vector_hits" in SQL and "keyword_hits" in SQL
        assert "<=>" in SQL  # cosine distance
        assert "ts_rank" in SQL  # full-text relevance

    def test_weights_are_bound_parameters(self):
        assert ":vector_weight" in SQL and ":keyword_weight" in SQL
        assert chunks_module.VECTOR_WEIGHT + chunks_module.KEYWORD_WEIGHT == 1.0
