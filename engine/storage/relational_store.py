"""Repository methods for persisting and querying normalized research entities.

"""

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

from engine.database import SessionLocal
from engine.models import (
    Workspace, Run, Track, Source, Evidence,
    Finding, Report, Claim, Score, LLMCall, Event
)

logger = logging.getLogger(__name__)


class RelationalStore:
    """
    Data Access Layer for Blueprint Section 10 relational entities.
    Handles persistence of research runs, evidence items, critic findings,
    claim verifications, evaluation scores, and audit events.
    """

    @staticmethod
    def get_session() -> Session:
        """Open a new SQLAlchemy session for one repository operation.

        Returns:
            A session bound to `SessionLocal`; the caller owns and must close it.
        """
        return SessionLocal()

    @classmethod
    def create_run(
        cls,
        question: str,
        settings: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
        run_id: Optional[str] = None,
        brief: Optional[Dict[str, Any]] = None,
        plan: Optional[List[Dict[str, Any]]] = None
    ) -> Run:
        """Initializes a new research run in the database."""
        db = cls.get_session()
        try:
            # Ensure a default workspace exists if workspace_id is provided or needed
            if user_id and not workspace_id:
                ws = db.query(Workspace).filter(Workspace.user_id == user_id).first()
                if not ws:
                    ws = Workspace(user_id=user_id, name="Default Workspace")
                    db.add(ws)
                    db.commit()
                    db.refresh(ws)
                workspace_id = ws.id

            run = Run(
                id=run_id or str(uuid.uuid4()),
                workspace_id=workspace_id,
                user_id=user_id,
                question=question,
                settings=settings or {},
                status="planning",
                stage="Initializing autonomous research...",
                progress=10,
                brief=brief,
                plan=plan
            )
            db.add(run)
            db.commit()
            db.refresh(run)
            return run
        finally:
            db.close()

    @classmethod
    def update_run_status(
        cls,
        run_id: str,
        status: Optional[str] = None,
        stage: Optional[str] = None,
        progress: Optional[int] = None,
        plan: Optional[List[Dict[str, Any]]] = None,
        brief: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None
    ) -> None:
        """Updates run lifecycle progression."""
        db = cls.get_session()
        try:
            run = db.query(Run).filter(Run.id == run_id).first()
            if not run:
                return

            if status is not None:
                run.status = status
                if status in ("completed", "failed", "cancelled"):
                    run.completed_at = datetime.now(timezone.utc)
            if stage is not None:
                run.stage = stage
            if progress is not None:
                run.progress = progress
            if plan is not None:
                run.plan = plan
            if brief is not None:
                run.brief = brief
            if error is not None:
                run.error = error

            db.commit()
        finally:
            db.close()

    @classmethod
    def save_tracks(cls, run_id: str, tracks_data: List[Dict[str, Any]]) -> List[Track]:
        """Saves research tracks associated with a run."""
        db = cls.get_session()
        try:
            created_tracks = []
            for t in tracks_data:
                track = Track(
                    id=str(uuid.uuid4()),
                    run_id=run_id,
                    title=t.get("sub_question") or t.get("title", "Research Track"),
                    subquestions=t.get("search_queries", []),
                    status=t.get("status", "pending"),
                    iterations=t.get("iterations", 1),
                    stats={**(t.get("stats", {}) or {}), "track_key": str(t.get("id", ""))}
                )
                db.add(track)
                created_tracks.append(track)
            db.commit()
            return created_tracks
        finally:
            db.close()

    @classmethod
    def update_track_stats(cls, run_id: str, title: str, status: str, stats: Dict[str, Any]) -> None:
        """Persist the final status and retrieval counts for a planned track."""
        db = cls.get_session()
        try:
            matches = db.query(Track).filter(Track.run_id == run_id, Track.title == title).all()
            track = next((item for item in matches if item.status in ("pending", "researching")), matches[0] if matches else None)
            if track:
                track.status = status
                track.stats = {**(track.stats or {}), **(stats or {})}
                track.iterations = int((stats or {}).get("iterations", track.iterations or 1))
                db.commit()
        finally:
            db.close()

    @classmethod
    def save_sources_and_evidence(
        cls,
        run_id: str,
        evidence_manifest: List[Dict[str, Any]]
    ) -> Dict[str, str]:
        """
        Persists deduplicated sources and atomic evidence records into Postgres/SQLite.
        Returns a mapping of manifest source_id tags (e.g. 'S1', 'D1') to database Source IDs.
        """
        db = cls.get_session()
        try:
            source_tag_to_id = {}
            seen_canonical = set()
            track_ids = {
                str(track.stats.get("track_key")): track.id
                for track in db.query(Track).filter(Track.run_id == run_id).all()
                if track.stats and track.stats.get("track_key")
            }

            for idx, ev in enumerate(evidence_manifest, 1):
                raw_tag = ev.get("source_id") or f"S{idx}"
                kind = ev.get("source_type", "web")
                track_keys = ev.get("track_ids") or ([str(ev.get("track_id"))] if ev.get("track_id") else [])
                db_track_id = next((track_ids[key] for key in track_keys if key in track_ids), None)
                canonical_url = ev.get("canonical_url") or ev.get("url") or ev.get("doc_name") or f"src_{idx}"

                # Deduplicate sources per run
                source = None
                if canonical_url and canonical_url in seen_canonical:
                    source = db.query(Source).filter(
                        Source.run_id == run_id,
                        Source.canonical_url == canonical_url
                    ).first()

                if not source:
                    source = Source(
                        id=str(uuid.uuid4()),
                        run_id=run_id,
                        kind=kind,
                        url=ev.get("url"),
                        canonical_url=canonical_url,
                        content_hash=ev.get("content_hash"),
                        title=ev.get("title") or ev.get("doc_name") or "Source",
                        domain=ev.get("domain") or ("vault" if kind == "user_doc" else "web"),
                        published_at=ev.get("published_date") or ev.get("date"),
                        authority_tier=ev.get("authority_score"),
                        tag=raw_tag,
                        track_id=db_track_id,
                    )
                    db.add(source)
                    db.flush()
                    seen_canonical.add(canonical_url)

                source_tag_to_id[raw_tag] = source.id

                # Create evidence record
                quote_text = ev.get("quote") or ev.get("text", "")[:600]
                evidence_record = Evidence(
                    id=str(uuid.uuid4()),
                    run_id=run_id,
                    source_id=source.id,
                    claim=ev.get("claim"),
                    track_id=db_track_id,
                    quote=quote_text,
                    location=ev.get("location") or (
                        f"Page {ev.get('page_number')}" if ev.get("page_number") else ev.get("url")
                    ),
                    values=ev.get("values", {}),
                    relevance=ev.get("relevance_score", 0.8),
                    final_score=ev.get("authority_score")
                )
                db.add(evidence_record)

            db.commit()
            return source_tag_to_id
        finally:
            db.close()

    @classmethod
    def save_critic_findings(cls, run_id: str, critic_audit: Dict[str, Any]) -> List[Finding]:
        """Saves critic audit contradictions, gaps, and arbiter queries."""
        db = cls.get_session()
        try:
            records = []
            # Contradictions
            for c in critic_audit.get("contradictions", []):
                finding = Finding(
                    id=str(uuid.uuid4()),
                    run_id=run_id,
                    type="contradiction",
                    description=f"Topic: {c.get('topic')}. Viewpoint A: {c.get('claim_a')} vs Viewpoint B: {c.get('claim_b')}",
                    evidence_ids=[c.get("source_a", ""), c.get("source_b", "")],
                    status="resolved" if c.get("resolution") else "open",
                    resolution_note=c.get("resolution"),
                    followup=critic_audit.get("arbiter_queries", []),
                    round=1
                )
                db.add(finding)
                records.append(finding)

            # Knowledge gaps
            for g in critic_audit.get("identified_gaps", []):
                finding = Finding(
                    id=str(uuid.uuid4()),
                    run_id=run_id,
                    type="gap",
                    description=g,
                    status="open",
                    round=1
                )
                db.add(finding)
                records.append(finding)

            db.commit()
            return records
        finally:
            db.close()

    @classmethod
    def save_report_and_claims(
        cls,
        run_id: str,
        markdown: str,
        outline: Optional[Dict[str, Any]] = None,
        guard_results: Optional[Dict[str, Any]] = None
    ) -> Report:
        """Saves the synthesized report and individual sentence-level verification claims."""
        db = cls.get_session()
        try:
            report = Report(
                id=str(uuid.uuid4()),
                run_id=run_id,
                version=1,
                markdown=markdown,
                outline=outline or {}
            )
            db.add(report)
            db.flush()

            # Persist claim-level entailment results; citation-ID validity alone
            # is never represented as a supported claim. Older callers may not
            # supply audited claims, so retain their cited statements as
            # explicitly unverified for inspection instead of dropping them.
            claim_items = list((guard_results or {}).get("claims", []))
            if not claim_items:
                rejected_claims = {
                    " ".join(str(claim).split())
                    for claim in ((guard_results or {}).get("rejected_claims") or [])
                    if isinstance(claim, str)
                }
                for line in markdown.splitlines():
                    stripped = line.strip()
                    if not stripped or stripped.startswith(("#", "|", "- [", "* [")):
                        continue
                    for sentence in re.split(r"(?<=[.!?])\s+", stripped):
                        tags = re.findall(r"\[((?:S|D)\d+)\]", sentence)
                        if tags:
                            normalized_sentence = " ".join(sentence.split())
                            is_rejected = normalized_sentence in rejected_claims
                            claim_items.append({
                                "sentence": sentence.strip(),
                                "tags": list(dict.fromkeys(tags)),
                                "verdict": "flagged" if is_rejected else "unverified",
                                "reason": (
                                    "The citation guard rejected this claim."
                                    if is_rejected
                                    else "This report was saved without a claim-entailment audit."
                                ),
                            })

            for item in claim_items:
                claim = Claim(
                    id=str(uuid.uuid4()),
                    report_id=report.id,
                    sentence=item.get("sentence", ""),
                    tags=item.get("tags", []),
                    verdict=item.get("verdict", "unverified"),
                    reason=item.get("reason", "No verifier result was recorded."),
                )
                db.add(claim)

            db.commit()
            db.refresh(report)
            return report
        finally:
            db.close()

    @classmethod
    def save_scores(
        cls,
        run_id: str,
        faithfulness: Optional[float],
        relevancy: Optional[float] = None,
        authority: Optional[float] = None,
        coverage: Optional[float] = None,
        details: Optional[Dict[str, Any]] = None
    ) -> Score:
        """Saves evaluation scores for a run."""
        db = cls.get_session()
        try:
            score = db.query(Score).filter(Score.run_id == run_id).first()
            if not score:
                score = Score(id=str(uuid.uuid4()), run_id=run_id)
                db.add(score)

            score.faithfulness = faithfulness
            score.relevancy = relevancy
            score.authority = authority
            score.coverage = coverage
            score.details = details or {}
            db.commit()
            db.refresh(score)
            return score
        finally:
            db.close()

    @classmethod
    def update_research_budget(cls, run_id: str, budget_usage: Dict[str, Any]) -> bool:
        """Persist final run-budget counters without replacing score details."""
        db = cls.get_session()
        try:
            score = db.query(Score).filter(Score.run_id == run_id).first()
            if not score:
                return False
            details = dict(score.details or {})
            details["research_budget"] = budget_usage
            score.details = details
            db.commit()
            return True
        finally:
            db.close()

    @classmethod
    def record_llm_call(
        cls,
        run_id: Optional[str],
        agent: str,
        model: str,
        tokens_in: int,
        tokens_out: int,
        latency_ms: float,
        cost: float = 0.0,
        cache_hit: bool = False,
        trace_id: Optional[str] = None
    ) -> Optional[LLMCall]:
        """Audits an individual LLM call into the cost and latency ledger."""
        db = cls.get_session()
        try:
            call = LLMCall(
                id=str(uuid.uuid4()),
                run_id=run_id,
                agent=agent,
                model=model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                latency_ms=latency_ms,
                cost=cost,
                cache_hit=cache_hit,
                trace_id=trace_id
            )
            db.add(call)
            db.commit()
            db.refresh(call)
            return call
        except Exception:
            logger.exception("Could not persist LLM-call usage for run %s", run_id)
            return None
        finally:
            db.close()

    @classmethod
    def get_run_cost(cls, run_id: str) -> float:
        """Return the persisted estimated provider cost accumulated by a run.

        Args:
            run_id: Stable run identifier.

        Returns:
            Sum of recorded call costs, or zero when no cost rows exist.

        Failure behavior:
            Database query failures propagate to the caller.
        """
        db = cls.get_session()
        try:
            from sqlalchemy import func
            value = db.query(func.coalesce(func.sum(LLMCall.cost), 0.0)).filter(LLMCall.run_id == run_id).scalar()
            return float(value or 0.0)
        finally:
            db.close()

    @classmethod
    def get_run_usage(cls, run_id: str) -> Dict[str, int]:
        """Return aggregate input/output token counts for a research run.

        Args:
            run_id: Stable run identifier.

        Returns:
            Mapping with `tokens_in` and `tokens_out` integer totals.

        Failure behavior:
            Database query failures propagate to the caller.
        """
        db = cls.get_session()
        try:
            from sqlalchemy import func
            row = db.query(
                func.coalesce(func.sum(LLMCall.tokens_in), 0),
                func.coalesce(func.sum(LLMCall.tokens_out), 0),
            ).filter(LLMCall.run_id == run_id).one()
            return {"tokens_in": int(row[0] or 0), "tokens_out": int(row[1] or 0)}
        finally:
            db.close()

    @classmethod
    def record_event(
        cls,
        run_id: str,
        event_type: str,
        payload: Dict[str, Any]
    ) -> Optional[Event]:
        """Appends an event to the durable sequence for SSE stream replay."""
        db = cls.get_session()
        try:
            last_event = db.query(Event).filter(Event.run_id == run_id).order_by(Event.seq.desc()).first()
            seq = (last_event.seq + 1) if last_event else 1

            event = Event(
                id=str(uuid.uuid4()),
                run_id=run_id,
                seq=seq,
                type=event_type,
                payload=payload
            )
            db.add(event)
            db.commit()
            db.refresh(event)
            return event
        except Exception:
            logger.exception("Could not persist event %s for run %s", event_type, run_id)
            return None
        finally:
            db.close()

    @classmethod
    def get_events(
        cls,
        run_id: str,
        after_seq: Optional[int] = None,
        after_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Retrieves stored events for a run in chronological order for SSE replay."""
        db = cls.get_session()
        try:
            query = db.query(Event).filter(Event.run_id == run_id)
            if after_id:
                target = db.query(Event).filter(Event.id == after_id).first()
                if target:
                    query = query.filter(Event.seq > target.seq)
            elif after_seq is not None:
                query = query.filter(Event.seq > after_seq)

            events = query.order_by(Event.seq.asc()).all()
            return [
                {
                    "id": str(e.id),
                    "seq": e.seq,
                    "event": e.type,
                    "data": e.payload,
                    "created_at": e.created_at.isoformat() if e.created_at else None
                }
                for e in events
            ]
        finally:
            db.close()

    @classmethod
    def get_run(cls, run_id: str) -> Optional[Dict[str, Any]]:
        """Returns run metadata as a dictionary."""
        db = cls.get_session()
        try:
            run = db.query(Run).filter(Run.id == run_id).first()
            if not run:
                return None
            return {
                "id": run.id,
                "question": run.question,
                "status": run.status,
                "stage": run.stage,
                "progress": run.progress,
                "created_at": run.created_at.isoformat() if run.created_at else None
            }
        finally:
            db.close()

    @classmethod
    def get_report(cls, run_id: str) -> Optional[Dict[str, Any]]:
        """Returns the latest report for a given run."""
        db = cls.get_session()
        try:
            report = db.query(Report).filter(Report.run_id == run_id).order_by(Report.created_at.desc()).first()
            if not report:
                return None
            return {
                "id": report.id,
                "run_id": report.run_id,
                "markdown": report.markdown,
                "created_at": report.created_at.isoformat() if report.created_at else None
            }
        finally:
            db.close()

    @classmethod
    def get_full_run_dossier(cls, run_id: str) -> Optional[Dict[str, Any]]:
        """
        Assembles the complete run dossier from relational records:
        run info, tracks, sources, evidence, findings, report, verified claims, and scores.
        """
        db = cls.get_session()
        try:
            run = db.query(Run).filter(Run.id == run_id).first()
            if not run:
                return None

            report = db.query(Report).filter(Report.run_id == run_id).order_by(Report.created_at.desc()).first()
            score = db.query(Score).filter(Score.run_id == run_id).first()

            sources = db.query(Source).filter(Source.run_id == run_id).all()
            findings = db.query(Finding).filter(Finding.run_id == run_id).all()
            tracks = db.query(Track).filter(Track.run_id == run_id).all()
            llm_calls = db.query(LLMCall).filter(LLMCall.run_id == run_id).order_by(LLMCall.created_at.asc()).all()
            events = db.query(Event).filter(Event.run_id == run_id).order_by(Event.seq.asc()).all()
            claims = db.query(Claim).filter(Claim.report_id == report.id).all() if report else []

            sources_list = [
                {
                    "source_id": s.tag,
                    "kind": "doc" if s.kind in {"doc", "user_doc"} else "web",
                    "title": s.title,
                    "url": s.url,
                    "canonical_url": s.canonical_url,
                    "domain": s.domain,
                    "authority_tier": s.authority_tier,
                    "published_at": s.published_at,
                    "snippet": next((item.quote for item in sorted(
                        s.evidence, key=lambda item: item.final_score or 0, reverse=True
                    ) if item.quote), None),
                    "location": next((item.location for item in s.evidence if item.location), None),
                }
                for s in sources
            ]

            findings_list = [
                {
                    "id": f.id,
                    "type": f.type,
                    "description": f.description,
                    "status": f.status,
                    "resolution_note": f.resolution_note
                }
                for f in findings
            ]

            claims_list = [
                {
                    "sentence": c.sentence,
                    "tags": c.tags,
                    "verdict": c.verdict,
                    "reason": c.reason
                }
                for c in claims
            ]

            tracks_list = [
                {
                    "id": t.id,
                    "title": t.title,
                    "status": "running" if t.status in ("pending", "researching") and run.status not in ("completed", "failed", "cancelled") else ("completed" if t.status == "completed" or run.status == "completed" else t.status),
                    "sources_count": (t.stats or {}).get("sources_found", 0),
                    "queries_count": len(t.subquestions or []),
                    "progress_pct": 100 if t.status == "completed" or run.status == "completed" else 50 if t.status == "researching" else 0,
                }
                for t in tracks
            ]
            llm_calls_list = [
                {
                    "id": call.id,
                    "agent": call.agent,
                    "model": call.model,
                    "tokens_in": call.tokens_in,
                    "tokens_out": call.tokens_out,
                    "latency_ms": call.latency_ms,
                    "cost": call.cost,
                    "cache_hit": call.cache_hit,
                    "trace_id": call.trace_id,
                    "created_at": call.created_at.isoformat() if call.created_at else None,
                }
                for call in llm_calls
            ]
            events_list = [
                {
                    "id": event.id,
                    "seq": event.seq,
                    "type": event.type,
                    "payload": event.payload,
                    "created_at": event.created_at.isoformat() if event.created_at else None,
                }
                for event in events
            ]
            provider_warnings = [event["payload"] for event in events_list if event["type"] == "provider_degraded"]
            research_warnings = [event["payload"] for event in events_list if event["type"] == "research_warning"]
            settings = run.settings or {}

            return {
                "run_id": run.id,
                "question": run.question,
                "query": run.question,
                "depth": settings.get("depth", "standard"),
                "status": run.status,
                "stage": run.stage,
                "progress": run.progress,
                "created_at": run.created_at.isoformat() if run.created_at else None,
                "completed_at": run.completed_at.isoformat() if run.completed_at else None,
                "report_markdown": report.markdown if report else None,
                "report_id": report.id if report else None,
                "scores": {
                    "faithfulness": score.faithfulness,
                    "relevancy": score.relevancy,
                    "authority": score.authority,
                    "coverage": score.coverage,
                    "citation_validity": (score.details or {}).get("citation_validity"),
                } if score else None,
                "budget_usage": (score.details or {}).get("research_budget") if score else None,
                "citation_validity_score": (score.details or {}).get("citation_validity") if score else None,
                "sources_count": len(sources),
                "sources": sources_list,
                "findings": findings_list,
                "claims": claims_list,
                "tracks_count": len(tracks),
                "tracks": tracks_list,
                "llm_calls": llm_calls_list,
                "events": events_list,
                "provider_warnings": provider_warnings,
                "research_warnings": research_warnings,
            }
        finally:
            db.close()

    @classmethod
    def update_report_markdown(cls, run_id: str, markdown: str) -> bool:
        """Updates the current report version after an authenticated addendum."""
        db = cls.get_session()
        try:
            report = db.query(Report).filter(Report.run_id == run_id).order_by(Report.created_at.desc()).first()
            if not report:
                return False
            report.markdown = markdown
            db.commit()
            return True
        finally:
            db.close()
