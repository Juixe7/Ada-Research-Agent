"""Pure metrics for comparing claim-support predictions with reference labels."""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Sequence

VERDICTS = ("supported", "partial", "unsupported")


def score_claim_verdicts(
    references: Sequence[str], predictions: Sequence[str | None]
) -> Dict[str, Any]:
    """Compute exact accuracy and per-class/macro precision, recall, and F1.

    Missing or invalid predictions count as unanswered and remain in the
    accuracy and recall denominators. They do not count as a predicted class.
    Empty inputs and mismatched lengths are rejected rather than reported as
    misleading zero scores.
    """
    if not references:
        raise ValueError("At least one reference verdict is required.")
    if len(references) != len(predictions):
        raise ValueError("References and predictions must have equal lengths.")
    if any(label not in VERDICTS for label in references):
        raise ValueError("Reference verdicts must use the supported verdict labels.")

    normalized: List[str] = [
        prediction if prediction in VERDICTS else "unanswered"
        for prediction in predictions
    ]
    confusion: Dict[str, Dict[str, int]] = {
        label: {predicted: 0 for predicted in (*VERDICTS, "unanswered")}
        for label in VERDICTS
    }
    for reference, prediction in zip(references, normalized):
        confusion[reference][prediction] += 1

    per_class: Dict[str, Dict[str, float | int]] = {}
    f1_values: List[float] = []
    for label in VERDICTS:
        true_positive = confusion[label][label]
        actual = sum(confusion[label].values())
        predicted = sum(confusion[actual_label][label] for actual_label in VERDICTS)
        precision = true_positive / predicted if predicted else 0.0
        recall = true_positive / actual if actual else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class[label] = {
            "support": actual,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
        }
        f1_values.append(f1)

    correct = sum(reference == prediction for reference, prediction in zip(references, normalized))
    return {
        "examples": len(references),
        "answered": sum(prediction != "unanswered" for prediction in normalized),
        "accuracy": round(correct / len(references), 4),
        "macro_f1": round(sum(f1_values) / len(f1_values), 4),
        "per_class": per_class,
        "confusion_matrix": confusion,
    }


def validate_claim_cases(cases: Sequence[Mapping[str, Any]]) -> None:
    """Validate the minimal, privacy-safe claim benchmark schema."""
    if not cases:
        raise ValueError("The benchmark must contain at least one case.")
    seen_ids = set()
    for case in cases:
        case_id = case.get("id")
        claim = case.get("claim")
        expected = case.get("expected_verdict")
        evidence = case.get("evidence")
        if not isinstance(case_id, str) or not case_id or case_id in seen_ids:
            raise ValueError("Each case needs a unique, non-empty string id.")
        if not isinstance(claim, str) or not claim.strip():
            raise ValueError(f"Case {case_id} needs a non-empty claim.")
        if expected not in VERDICTS:
            raise ValueError(f"Case {case_id} has an invalid expected_verdict.")
        if not isinstance(evidence, list) or not evidence:
            raise ValueError(f"Case {case_id} needs at least one evidence item.")
        if any(not isinstance(item, str) or not item.strip() for item in evidence):
            raise ValueError(f"Case {case_id} evidence items must be non-empty strings.")
        seen_ids.add(case_id)
