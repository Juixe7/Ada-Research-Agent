"""Offline contract checks for claim evaluation metrics and the smoke dataset."""

import json
from pathlib import Path

import pytest

from engine.evaluation.claim_metrics import score_claim_verdicts, validate_claim_cases


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
    dataset = json.loads((ROOT / "evals" / "claim_support_smoke.json").read_text(encoding="utf-8"))
    cases = dataset["cases"]
    validate_claim_cases(cases)

    assert len(cases) == 12
    assert {label: sum(case["expected_verdict"] == label for case in cases)
            for label in ("supported", "partial", "unsupported")} == {
                "supported": 4, "partial": 4, "unsupported": 4
            }
    assert "Synthetic" in dataset["provenance"]


def test_benchmark_rejects_duplicate_case_ids() -> None:
    case = {"id": "same", "claim": "A claim", "expected_verdict": "supported", "evidence": ["Evidence"]}
    with pytest.raises(ValueError, match="unique"):
        validate_claim_cases([case, case])
