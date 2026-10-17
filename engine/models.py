import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, DateTime, Boolean, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from engine.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

# ── User & Auth Models (Preserved) ───────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    sessions = relationship("ResearchSession", back_populates="user", cascade="all, delete-orphan")
    vault_documents = relationship("VaultDocument", back_populates="user", cascade="all, delete-orphan")
    workspaces = relationship("Workspace", back_populates="user", cascade="all, delete-orphan")
    runs = relationship("Run", back_populates="user")


class ResearchSession(Base):
    __tablename__ = "research_sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="sessions")
    turns = relationship("ResearchTurn", back_populates="session", cascade="all, delete-orphan", order_by="ResearchTurn.turn_index")


class ResearchTurn(Base):
    __tablename__ = "research_turns"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(36), ForeignKey("research_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    turn_index = Column(Integer, nullable=False, default=1)
    query = Column(Text, nullable=False)
    executive_title = Column(String(255), nullable=True)
    status = Column(String(50), default="planning", index=True)  # planning, running, completed, cancelled, failed
    progress = Column(Integer, default=10)
    stage = Column(String(255), default="Initializing autonomous research...")
    working_memory_json = Column(Text, nullable=True)  # JSON string of 300-word memory + cited URLs
    report_json_path = Column(String(255), nullable=True)
    is_public = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    session = relationship("ResearchSession", back_populates="turns")


class VaultDocument(Base):
    __tablename__ = "vault_documents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    doc_name = Column(String(255), nullable=False, index=True)
    file_size = Column(Integer, default=0)
    chunk_count = Column(Integer, default=0)
    uploaded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="vault_documents")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(64), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User")


# ── Blueprint Section 10: Relational Research Data Model ─────

class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False, default="Default Workspace")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="workspaces")
    runs = relationship("Run", back_populates="workspace", cascade="all, delete-orphan")


class Run(Base):
    __tablename__ = "runs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    workspace_id = Column(String(36), ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    parent_run_id = Column(String(36), ForeignKey("runs.id", ondelete="SET NULL"), nullable=True, index=True)

    question = Column(Text, nullable=False)
    settings = Column(JSON, nullable=True)  # { depth: "deep", include_user_docs: true, domains: [] }

    # Status progression (Blueprint Section 10):
    # scoping -> awaiting_clarification -> planning -> researching -> auditing -> writing -> verifying -> completed (or failed, cancelled)
    status = Column(String(50), default="planning", index=True)
    stage = Column(String(255), default="Initializing autonomous research...")
    progress = Column(Integer, default=10)

    brief = Column(JSON, nullable=True)         # Clarified user brief & scope
    plan = Column(JSON, nullable=True)          # Structured array of tracks
    assumptions = Column(JSON, nullable=True)   # Scope assumptions when skipped
    error = Column(Text, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    workspace = relationship("Workspace", back_populates="runs")
    user = relationship("User", back_populates="runs")
    parent_run = relationship("Run", remote_side=[id], backref="followup_runs")

    tracks = relationship("Track", back_populates="run", cascade="all, delete-orphan")
    sources = relationship("Source", back_populates="run", cascade="all, delete-orphan")
    evidence = relationship("Evidence", back_populates="run", cascade="all, delete-orphan")
    findings = relationship("Finding", back_populates="run", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="run", cascade="all, delete-orphan")
    scores = relationship("Score", back_populates="run", cascade="all, delete-orphan", uselist=False)
    memories = relationship("Memory", back_populates="run", cascade="all, delete-orphan")
    llm_calls = relationship("LLMCall", back_populates="run", cascade="all, delete-orphan")
    events = relationship("Event", back_populates="run", cascade="all, delete-orphan", order_by="Event.seq")


class Track(Base):
    __tablename__ = "tracks"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    run_id = Column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    subquestions = Column(JSON, nullable=True)  # List of query strings / subtasks
    status = Column(String(50), default="pending")  # pending, researching, completed, failed
    iterations = Column(Integer, default=1)
    stats = Column(JSON, nullable=True)  # { sources_found: 8, pages_scraped: 2, duration_sec: 12.4 }

    run = relationship("Run", back_populates="tracks")


class Source(Base):
    __tablename__ = "sources"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    run_id = Column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    track_id = Column(String(36), nullable=True)
    kind = Column(String(20), default="web")  # "web" or "doc"
    url = Column(Text, nullable=True)
    canonical_url = Column(Text, nullable=True, index=True)
    title = Column(String(500), nullable=True)
    domain = Column(String(255), nullable=True)
    published_at = Column(String(100), nullable=True)
    authority_tier = Column(Float, default=0.7)
    content_hash = Column(String(64), nullable=True)
    tag = Column(String(20), nullable=False)  # S1, S2, D1, D2
    fetched_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    run = relationship("Run", back_populates="sources")
    evidence = relationship("Evidence", back_populates="source", cascade="all, delete-orphan")


class Evidence(Base):
    __tablename__ = "evidence"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    run_id = Column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    source_id = Column(String(36), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True)
    track_id = Column(String(36), nullable=True)

    claim = Column(Text, nullable=True)
    quote = Column(Text, nullable=False)        # Verbatim quote excerpt
    location = Column(String(255), nullable=True)  # Page number, section header, or URL
    values = Column(JSON, nullable=True)        # Structured metric values for quantitative tables
    relevance = Column(Float, default=0.8)
    final_score = Column(Float, default=0.8)

    run = relationship("Run", back_populates="evidence")
    source = relationship("Source", back_populates="evidence")


class Finding(Base):
    __tablename__ = "findings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    run_id = Column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(50), nullable=False)   # "contradiction", "gap", "bias"
    description = Column(Text, nullable=False)
    evidence_ids = Column(JSON, nullable=True)  # List of source tags/IDs involved
    status = Column(String(50), default="open") # "open", "resolved"
    resolution_note = Column(Text, nullable=True)
    followup = Column(JSON, nullable=True)      # Arbiter queries proposed
    round = Column(Integer, default=1)

    run = relationship("Run", back_populates="findings")


class Report(Base):
    __tablename__ = "reports"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    run_id = Column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, default=1)
    markdown = Column(Text, nullable=False)
    outline = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    run = relationship("Run", back_populates="reports")
    claims = relationship("Claim", back_populates="report", cascade="all, delete-orphan")


class Claim(Base):
    __tablename__ = "claims"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    report_id = Column(String(36), ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True)
    sentence = Column(Text, nullable=False)
    tags = Column(JSON, nullable=True)          # ['S1', 'D2']
    verdict = Column(String(50), default="supported")  # "supported", "partial", "flagged"
    reason = Column(Text, nullable=True)
    section = Column(String(255), nullable=True)

    report = relationship("Report", back_populates="claims")


class Score(Base):
    __tablename__ = "scores"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    run_id = Column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    faithfulness = Column(Float, nullable=True, default=None)
    relevancy = Column(Float, nullable=True, default=None)
    authority = Column(Float, nullable=True, default=None)
    coverage = Column(Float, nullable=True, default=None)
    details = Column(JSON, nullable=True)

    run = relationship("Run", back_populates="scores")


class Memory(Base):
    __tablename__ = "memories"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    run_id = Column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(JSON, nullable=False)      # Working memory: condensed facts, visited URLs, unresolved gaps
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    run = relationship("Run", back_populates="memories")


class LLMCall(Base):
    __tablename__ = "llm_calls"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    run_id = Column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=True, index=True)
    agent = Column(String(100), nullable=False)
    model = Column(String(100), nullable=False)
    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    latency_ms = Column(Float, default=0.0)
    cost = Column(Float, default=0.0)
    cache_hit = Column(Boolean, default=False)
    trace_id = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    run = relationship("Run", back_populates="llm_calls")


class Event(Base):
    __tablename__ = "events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    run_id = Column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True)
    seq = Column(Integer, nullable=False, default=1)
    type = Column(String(100), nullable=False, index=True)  # run.status, track.progress, finding.raised, etc.
    payload = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    run = relationship("Run", back_populates="events")
