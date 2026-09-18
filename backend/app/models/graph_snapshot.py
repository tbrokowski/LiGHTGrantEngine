"""Precomputed graph atlas snapshots.

One row per graph kind ("opportunities", "archive"). The payload is the gzipped
columnar atlas produced by the clustering task — the same bytes for every user,
written once per clustering run and served directly with an ETag.

Storing it rather than assembling per request is what makes a whole-corpus graph
viable: building it touches every node and edge in the database, which is a
batch job, not something to do inside a request that many people hit.
"""
from datetime import datetime

from sqlalchemy import String, Integer, DateTime, LargeBinary, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GraphSnapshot(Base):
    __tablename__ = "graph_snapshots"

    # "opportunities" | "archive" — one current snapshot per kind.
    kind: Mapped[str] = mapped_column(String(50), primary_key=True)
    # Gzipped JSON; served as-is with Content-Encoding: gzip.
    payload: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # sha256 prefix of `payload`, used directly as the HTTP ETag.
    etag: Mapped[str] = mapped_column(String(64), nullable=False)
    node_count: Mapped[int] = mapped_column(Integer, default=0)
    edge_count: Mapped[int] = mapped_column(Integer, default=0)
    format_version: Mapped[int] = mapped_column(Integer, default=1)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
