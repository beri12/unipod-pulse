"""Initial RecallAI schema, with pgvector and the retrieval indexes.

Revision ID: 0001_initial
Revises:
"""

from __future__ import annotations

from alembic import op

from app.core.config import get_settings
from app.db.models import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # Must exist before the vector columns are created.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind)

    dimensions = get_settings().embedding_dimensions

    # HNSW for cosine distance: the vector index the hybrid search rides on.
    # Built after the tables so it picks up the column's real dimensions.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS ix_chunks_embedding_hnsw
        ON knowledge_chunks
        USING hnsw ((embedding::vector({dimensions})) vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        """
    )

    # The keyword half of hybrid retrieval.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_chunks_content_fts
        ON knowledge_chunks
        USING gin (to_tsvector('simple', content))
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_chunks_content_fts")
    op.execute("DROP INDEX IF EXISTS ix_chunks_embedding_hnsw")
    Base.metadata.drop_all(op.get_bind())
