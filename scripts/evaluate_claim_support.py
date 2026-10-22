"""Run Ada's claim-support judge on the privacy-safe synthetic smoke benchmark."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engine.agents.claim_verifier import verify_claims  # noqa: E402
from engine.evaluation.claim_metrics import score_claim_verdicts, validate_claim_cases  # noqa: E402


def run(dataset_path: Path, output_path: Path | None = None) -> dict[str, Any]:
    """Run one batched judge call and optionally persist its aggregate result."""
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    cases = dataset.get("cases")
    validate_claim_cases(cases)
    claims = [
        {"claim_id": index, "sentence": case["claim"], "tags": [f"S{index}"]}
        for index, case in enumerate(cases, start=1)
    ]
    evidence = {
        f"S{index}": {"title": f"Synthetic evidence {index}", "text": "\n".join(case["evidence"])}
        for index, case in enumerate(cases, start=1)
    }
    run_id = f"claim-eval-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    verdicts = verify_claims(claims, evidence, run_id=run_id)
    predictions = [verdicts.get(index, {}).get("verdict") for index in range(1, len(cases) + 1)]
    metrics = score_claim_verdicts([case["expected_verdict"] for case in cases], predictions)
    report = {
        "benchmark": dataset.get("name"),
        "benchmark_version": dataset.get("version"),
        "provenance": dataset.get("provenance"),
        "run_id": run_id,
        "model_verdicts": [
            {"id": case["id"], "expected": case["expected_verdict"],
             "predicted": predictions[index], "reason": verdicts.get(index + 1, {}).get("reason")}
            for index, case in enumerate(cases)
        ],
        "metrics": metrics,
        "limitations": [
            "Synthetic smoke benchmark only; scores are not estimates of real research quality.",
            "Claim-support judgments are model outputs and require human review before being treated as labels.",
            "A missing or invalid verdict is counted as unanswered, not silently dropped.",
        ],
    }
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=ROOT / "evals" / "claim_support_smoke.json")
    parser.add_argument("--output", type=Path, help="Optional path for the JSON result.")
    args = parser.parse_args()
    try:
        run(args.dataset, args.output)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Evaluation could not run: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
