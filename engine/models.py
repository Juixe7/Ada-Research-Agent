"""SQLAlchemy entities for accounts, research sessions, normalized runs, evidence, reports, and telemetry.

"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import String, Integer, Float, DateTime, Boolean, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from engine.database import Base

def generate_uuid() -> str:
    """Generate a UUID4 string for a new database entity."""
    return str(uuid.uuid4())

# ── User & Auth Models (Preserved) ───────────────────────────

class User(Base):
    """Account credentials and profile metadata."""
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    sessions: Mapped[list[ResearchSession]] = relationship(back_populates="user", cascade="all, delete-orphan")
    vault_documents: Mapped[list[VaultDocument]] = relationship(back_populates="user", cascade="all, delete-orphan")
    workspaces: Mapped[list[Workspace]] = relationship(back_populates="user", cascade="all, delete-orphan")
    runs: Mapped[list[Run]] = relationship(back_populates="user")


class ResearchSession(Base):
    """An owner-scoped sequence of related research turns."""
    __tablename__ = "research_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    user: Mapped[User] = relationship(back_populates="sessions")
    turns: Mapped[list[ResearchTurn]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ResearchTurn.turn_index"
    )


class ResearchTurn(Base):
    """One question/result lifecycle entry within a research session."""
    __tablename__ = "research_turns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("research_sessions.id", ondelete="CASCADE"), index=True)
    turn_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    query: Mapped[str] = mapped_column(Text, nullable=False)
    executive_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str | None] = mapped_column(String(50), default="planning", index=True)
    progress: Mapped[int | None] = mapped_column(Integer, default=10)
    stage: Mapped[str | None] = mapped_column(String(255), default="Initializing autonomous research...")
    working_memory_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_json_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_public: Mapped[bool | None] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    session: Mapped[ResearchSession] = relationship(back_populates="turns")


class VaultDocument(Base):
    """Metadata for a user-owned uploaded or pasted source document."""
    __tablename__ = "vault_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    doc_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    file_size: Mapped[int | None] = mapped_column(Integer, default=0)
    chunk_count: Mapped[int | None] = mapped_column(Integer, default=0)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    user: Mapped[User] = relationship(back_populates="vault_documents")


class PasswordResetToken(Base):
    """Hashed one-time password reset token and expiry."""
    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    user: Mapped[User] = relationship()


# ── Blueprint Section 10: Relational Research Data Model ─────

class Workspace(Base):
    """Owner-scoped container for normalized runs."""
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="Default Workspace")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    user: Mapped[User] = relationship(back_populates="workspaces")
    runs: Mapped[list[Run]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class Run(Base):
    """Normalized research-run lifecycle and configuration record."""
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    workspace_id: Mapped[str | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    parent_run_id: Mapped[str | None] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"), index=True)

    question: Mapped[str] = mapped_column(Text, nullable=False)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    # Status progression (Blueprint Section 10):
    # scoping -> awaiting_clarification -> planning -> researching -> auditing -> writing -> verifying -> completed (or failed, cancelled)
    status: Mapped[str | None] = mapped_column(String(50), default="planning", index=True)
    stage: Mapped[str | None] = mapped_column(String(255), default="Initializing autonomous research...")
    progress: Mapped[int | None] = mapped_column(Integer, default=10)

    brief: Mapped[Any | None] = mapped_column(JSON)
    plan: Mapped[Any | None] = mapped_column(JSON)
    assumptions: Mapped[Any | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    workspace: Mapped[Workspace | None] = relationship(back_populates="runs")
    user: Mapped[User | None] = relationship(back_populates="runs")
    parent_run: Mapped[Run | None] = relationship(remote_side=[id], backref="followup_runs")

    tracks: Mapped[list[Track]] = relationship(back_populates="run", cascade="all, delete-orphan")
    sources: Mapped[list[Source]] = relationship(back_populates="run", cascade="all, delete-orphan")
    evidence: Mapped[list[Evidence]] = relationship(back_populates="run", cascade="all, delete-orphan")
    findings: Mapped[list[Finding]] = relationship(back_populates="run", cascade="all, delete-orphan")
    reports: Mapped[list[Report]] = relationship(back_populates="run", cascade="all, delete-orphan")
    scores: Mapped[Score | None] = relationship(back_populates="run", cascade="all, delete-orphan", uselist=False)
    memories: Mapped[list[Memory]] = relationship(back_populates="run", cascade="all, delete-orphan")
    llm_calls: Mapped[list[LLMCall]] = relationship(back_populates="run", cascade="all, delete-orphan")
    events: Mapped[list[Event]] = relationship(back_populates="run", cascade="all, delete-orphan", order_by="Event.seq")


class Track(Base):
    """Sub-question execution metadata for one run."""
    __tablename__ = "tracks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subquestions: Mapped[Any | None] = mapped_column(JSON)
    status: Mapped[str | None] = mapped_column(String(50), default="pending")
    iterations: Mapped[int | None] = mapped_column(Integer, default=1)
    stats: Mapped[Any | None] = mapped_column(JSON)

    run: Mapped[Run] = relationship(back_populates="tracks")


class Source(Base):
    """A web or private-document source referenced by evidence."""
    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    track_id: Mapped[str | None] = mapped_column(String(36))
    kind: Mapped[str | None] = mapped_column(String(20), default="web")
    url: Mapped[str | None] = mapped_column(Text)
    canonical_url: Mapped[str | None] = mapped_column(Text, index=True)
    title: Mapped[str | None] = mapped_column(String(500))
    domain: Mapped[str | None] = mapped_column(String(255))
    published_at: Mapped[str | None] = mapped_column(String(100))
    authority_tier: Mapped[float | None] = mapped_column(Float, default=0.7)
    content_hash: Mapped[str | None] = mapped_column(String(64))
    tag: Mapped[str] = mapped_column(String(20), nullable=False)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    run: Mapped[Run] = relationship(back_populates="sources")
    evidence: Mapped[list[Evidence]] = relationship(back_populates="source", cascade="all, delete-orphan")


class Evidence(Base):
    """A retrieved passage linked to its source and research track."""
    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    track_id: Mapped[str | None] = mapped_column(String(36))

    claim: Mapped[str | None] = mapped_column(Text)
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[str | None] = mapped_column(String(255))
    values: Mapped[Any | None] = mapped_column(JSON)
    relevance: Mapped[float | None] = mapped_column(Float, default=0.8)
    final_score: Mapped[float | None] = mapped_column(Float, default=0.8)

    run: Mapped[Run] = relationship(back_populates="evidence")
    source: Mapped[Source] = relationship(back_populates="evidence")


class Finding(Base):
    """Critic finding about coverage, contradiction, or evidence quality."""
    __tablename__ = "findings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_ids: Mapped[Any | None] = mapped_column(JSON)
    status: Mapped[str | None] = mapped_column(String(50), default="open")
    resolution_note: Mapped[str | None] = mapped_column(Text)
    followup: Mapped[Any | None] = mapped_column(JSON)
    round: Mapped[int | None] = mapped_column(Integer, default=1)

    run: Mapped[Run] = relationship(back_populates="findings")


class Report(Base):
    """Persisted report metadata and generated content reference."""
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    version: Mapped[int | None] = mapped_column(Integer, default=1)
    markdown: Mapped[str] = mapped_column(Text, nullable=False)
    outline: Mapped[Any | None] = mapped_column(JSON)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    run: Mapped[Run] = relationship(back_populates="reports")
    claims: Mapped[list[Claim]] = relationship(back_populates="report", cascade="all, delete-orphan")


class Claim(Base):
    """A report claim and its evidence-support assessment."""
    __tablename__ = "claims"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    sentence: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[Any | None] = mapped_column(JSON)
    verdict: Mapped[str | None] = mapped_column(String(50), default="supported")
    reason: Mapped[str | None] = mapped_column(Text)
    section: Mapped[str | None] = mapped_column(String(255))

    report: Mapped[Report] = relationship(back_populates="claims")


class Score(Base):
    """Run quality/evaluation metric record."""
    __tablename__ = "scores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), unique=True, index=True)
    faithfulness: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    relevancy: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    authority: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    coverage: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    details: Mapped[Any | None] = mapped_column(JSON)

    run: Mapped[Run] = relationship(back_populates="scores")


class Memory(Base):
    """Condensed prior-session context used for follow-up planning."""
    __tablename__ = "memories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    content: Mapped[Any] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    run: Mapped[Run] = relationship(back_populates="memories")


class LLMCall(Base):
    """Per-model-call usage, latency, cost, and trace metadata."""
    __tablename__ = "llm_calls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    run_id: Mapped[str | None] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    agent: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    tokens_in: Mapped[int | None] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int | None] = mapped_column(Integer, default=0)
    latency_ms: Mapped[float | None] = mapped_column(Float, default=0.0)
    cost: Mapped[float | None] = mapped_column(Float, default=0.0)
    cache_hit: Mapped[bool | None] = mapped_column(Boolean, default=False)
    trace_id: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    run: Mapped[Run | None] = relationship(back_populates="llm_calls")


class Event(Base):
    """Sequenced lifecycle event persisted for run replay."""
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    payload: Mapped[Any] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    run: Mapped[Run] = relationship(back_populates="events")
