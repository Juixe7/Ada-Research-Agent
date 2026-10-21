"""Regression checks for provenance, truthful fallbacks, and quality metrics."""

from engine.agents import critic, preflight
from engine.budget import ResearchBudget
from engine.graph.nodes import normalize_and_deduplicate_evidence
from engine.graph import pipeline
from engine.guards.citation_guard import verify_and_ground_citations
from engine.ingest.web_scraper import scrape_webpage
from engine.metrics import calculate_research_metrics
from engine.workers.research_worker import _evidence_passage


def test_preflight_failure_returns_no_invented_sources(monkeypatch):
    monkeypatch.setattr("engine.agents.llm_resilient.call_resilient_llm", lambda **_: None)

    result = preflight.evaluate_preflight_scope("Ada research", user_id="user-1")

    assert result["status"] == "unavailable"
    assert result["ambiguity_sources"] == {}
    assert result["clarification_options"] == []
    assert result["research_angles"] == []


def test_preflight_discards_model_claimed_web_sources_without_search_evidence(monkeypatch):
    response = (
        '{"ambiguity_detected": true, "ambiguity_sources": '
        '{"web": {"entity": "Invented Corp", "origin": "Nowhere"}}, '
        '"clarification_options": [], "research_angles": []}'
    )
    monkeypatch.setattr("engine.agents.llm_resilient.call_resilient_llm", lambda **_: response)

    result = preflight.evaluate_preflight_scope("Invented Corp", user_id="user-1")

    assert result["ambiguity_sources"] == {}


def test_critic_failure_does_not_create_fabricated_gaps_or_queries(monkeypatch):
    monkeypatch.setattr("engine.agents.llm_resilient.call_resilient_llm", lambda **_: None)

    result = critic.audit_research_evidence("solar recycling", [], [])

    assert result["status"] == "unavailable"
    assert result["coverage_score"] is None
    assert result["identified_gaps"] == []
    assert result["arbiter_queries"] == []


def test_evidence_quote_is_verbatim_and_limited_to_600_characters():
    raw = "Overview\n\nBattery recovery reached 92.4 percent in the pilot study. More context follows."

    result = _evidence_passage(raw, "battery recovery pilot")

    assert result["text"] in raw
    assert result["quote"] in raw
    assert len(result["quote"]) <= 600
    assert "Battery recovery" in result["quote"]


def test_coverage_requires_relevance_and_two_independent_sources():
    plan = [{"id": "1"}, {"id": "2"}]
    relevance = {"1": {"score": 0.9}, "2": {"score": 0.8}}
    evidence = [
        {"source_type": "web", "url": "https://example.org/a", "track_id": "1", "authority_score": 0.8},
        {"source_type": "web", "url": "https://other.org/b", "track_id": "1", "authority_score": 0.7},
        {"source_type": "web", "url": "https://third.org/a", "track_id": "2", "authority_score": 0.9},
    ]

    result = calculate_research_metrics(plan, evidence, relevance, 0.95)

    assert result["scores"]["coverage"] == 0.5
    assert result["details"]["covered_tracks"] == ["1"]
    assert result["scores"]["relevancy"] == 0.85


def test_missing_relevance_judgment_means_metrics_are_unknown():
    result = calculate_research_metrics(
        [{"id": "1"}, {"id": "2"}], [], {"1": {"score": 0.9}}, None
    )

    assert result["scores"]["relevancy"] is None
    assert result["scores"]["coverage"] is None
    assert result["details"]["relevance_complete"] is False


def test_evidence_normalization_deduplicates_tracking_parameters_and_fragments():
    items = [
        {"url": "https://www.example.org/report/?utm_source=one#summary", "title": "Report", "track_id": "1"},
        {"url": "https://example.org/report?utm_source=two", "title": "Report", "track_id": "2"},
    ]

    result = normalize_and_deduplicate_evidence(items)

    assert len(result) == 1
    assert result[0]["canonical_url"] == "https://example.org/report"
    assert result[0]["track_ids"] == ["1", "2"]


def test_report_without_citations_has_unknown_citation_validity():
    result = verify_and_ground_citations("A factual statement without a citation.", [])

    assert result["citation_validity_score"] is None
    assert result["faithfulness_score"] is None


def test_research_budget_reserves_parallel_work_with_hard_caps():
    budget = ResearchBudget(max_searches=1, max_fetches=1, timeout_seconds=30)

    assert budget.reserve("searches") is True
    assert budget.reserve("searches") is False
    assert budget.reserve("fetches") is True
    assert budget.reserve("fetches") is False
    assert budget.snapshot()["limits_reached"] == ["fetches", "searches"]


def test_research_budget_publishes_live_usage_and_cap_changes():
    snapshots = []
    budget = ResearchBudget(
        max_searches=1,
        max_fetches=1,
        timeout_seconds=30,
        on_change=snapshots.append,
    )

    assert budget.reserve("searches") is True
    assert budget.reserve("searches") is False

    assert snapshots[0]["searches_used"] == 1
    assert snapshots[0]["searches_limit"] == 1
    assert snapshots[1]["limits_reached"] == ["searches"]


def test_pipeline_streams_budget_snapshots_for_live_run_counters(monkeypatch):
    published = []
    monkeypatch.setenv("LANGFUSE_ENABLED", "false")

    def fake_invoke(state):
        assert state["resource_budget"].reserve("searches") is True
        assert state["resource_budget"].reserve("fetches") is True
        return {"report_markdown": "A verified test report", "evidence_manifest": []}

    monkeypatch.setattr(pipeline, "get_job_state", lambda _: {"report_id": "budget-test"})
    monkeypatch.setattr(pipeline, "set_job_state", lambda *_: None)
    monkeypatch.setattr(pipeline.compiled_research_graph, "invoke", fake_invoke)
    monkeypatch.setattr(
        "engine.events.publish_event",
        lambda run_id, event_type, data: published.append((run_id, event_type, data)),
    )

    pipeline.execute_graph_pipeline("budget test", report_id="budget-test")

    updates = [item for item in published if item[1] == "budget_updated"]
    assert len(updates) == 3  # Initial limits plus one update for each reservation.
    assert updates[-1][2]["budget"]["searches_used"] == 1
    assert updates[-1][2]["budget"]["fetches_used"] == 1


def test_page_fetch_observes_cancellation_before_network_access():
    result = scrape_webpage("https://example.org/article", cancel_check=lambda: True)

    assert result["method"] == "cancelled"
    assert result["text"] == ""
