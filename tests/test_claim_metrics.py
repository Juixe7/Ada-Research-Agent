"""Offline contract checks for claim evaluation metrics and the smoke dataset."""

import json
from pathlib import Path

import pytest

from engine.evaluation.claim_metrics import score_claim_verdicts, validate_claim_cases
from engine.agents.claim_verifier import ClaimAudit, _parse_claim_audit
from packages.llm_gateway.models import LLMResult


ROOT = Path(__file__).resolve().parents[1]


def test_claim_metrics_count_missing_verdicts_as_unanswered() -> None:
    result = score_claim_verdicts(
        ["supported", "partial", "unsupported"],
        ["supported", None, "supported"],
    )

    assert result["examples"] == 3
    assert result["answered"] == 2
    assert result["accuracy"] == pytest.approx(1 / 3, abs=0.0001)
    assert result["confusion_matrix"]["partial"]["unanswered"] == 1
    assert result["per_class"]["partial"]["recall"] == 0


def test_claim_metric_input_validation() -> None:
    with pytest.raises(ValueError, match="equal lengths"):
        score_claim_verdicts(["supported"], [])
    with pytest.raises(ValueError, match="At least one"):
        score_claim_verdicts([], [])


def test_checked_in_smoke_dataset_has_balanced_labels_and_valid_schema() -> None:
    dataset = json.loads((ROOT / "evals" / "claim_support_benchmark.json").read_text(encoding="utf-8"))
    cases = dataset["cases"]
    validate_claim_cases(cases)

    assert len(cases) == 24
    assert {label: sum(case["expected_verdict"] == label for case in cases)
            for label in ("supported", "partial", "unsupported")} == {
                "supported": 8, "partial": 8, "unsupported": 8
            }
    assert "source-checked" in dataset["provenance"]
    assert len(dataset["sources"]) == 2


def test_benchmark_rejects_duplicate_case_ids() -> None:
    case = {"id": "same", "claim": "A claim", "expected_verdict": "supported", "evidence": ["Evidence"]}
    with pytest.raises(ValueError, match="unique"):
        validate_claim_cases([case, case])


def test_claim_audit_accepts_provider_json_array_after_schema_validation() -> None:
    result = LLMResult(
        content='[{"claim_id":1,"verdict":"partial","reason":"The evidence supports only the narrower claim."}]',
        parsed=None,
    )

    parsed = _parse_claim_audit(result)

    assert isinstance(parsed, ClaimAudit)
    assert parsed.claims[0].claim_id == 1
    assert parsed.claims[0].verdict == "partial"


def test_claim_audit_rejects_invalid_provider_json_array() -> None:
    result = LLMResult(content='[{"claim_id":"bad","verdict":"maybe"}]', parsed=None)

    assert _parse_claim_audit(result) is None
