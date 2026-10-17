from engine.agents.report_followup import rank_report_evidence


def test_rank_report_evidence_prefers_passages_matching_the_question():
    evidence = [
        {"source_id": "S1", "title": "Weather", "text": "Rainfall increased in the region."},
        {"source_id": "D1", "title": "Resume project", "text": "The project reduced report generation latency by 35 percent."},
        {"source_id": "S2", "title": "Energy costs", "text": "The system's energy cost declined after deployment."},
    ]

    result = rank_report_evidence("What reduced report generation latency?", evidence)

    assert result
    assert result[0]["source_id"] == "D1"


def test_rank_report_evidence_returns_empty_when_nothing_matches():
    evidence = [{"source_id": "S1", "title": "Weather", "text": "Rainfall increased in the region."}]

    assert rank_report_evidence("How many satellites were launched?", evidence) == []


def test_selected_passage_text_can_help_retrieve_a_passage():
    evidence = [
        {"source_id": "S1", "title": "Research notes", "text": "A useful passage describing the project results."},
        {"source_id": "S2", "title": "Weather", "text": "Rainfall increased in the region."},
    ]

    result = rank_report_evidence("What does this mean?", evidence, "useful passage describing the project")

    assert result
    assert result[0]["source_id"] == "S1"
