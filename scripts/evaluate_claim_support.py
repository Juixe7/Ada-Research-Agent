"""Run Ada's claim-support judge on a privacy-safe, source-checked benchmark."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engine.agents.claim_verifier import (  # noqa: E402
    CLAIM_VERIFIER_PROMPT_VERSION,
    ClaimPromptVersion,
    verify_claims_with_result,
)
from engine.evaluation.claim_metrics import score_claim_verdicts, validate_claim_cases  # noqa: E402
from engine.observability import research_run_trace  # noqa: E402
from packages.llm_gateway.tracing import trace_id_for_run  # noqa: E402


def run(
    dataset_path: Path,
    output_path: Path | None = None,
    batch_size: int = 8,
    prompt_version: ClaimPromptVersion = CLAIM_VERIFIER_PROMPT_VERSION,
) -> dict[str, Any]:
    """Run bounded judge batches and optionally persist aggregate results."""
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    cases = dataset.get("cases")
    validate_claim_cases(cases)
    if not 1 <= batch_size <= 60:
        raise ValueError("batch_size must be between 1 and 60.")
    claims = [
        {"claim_id": index, "sentence": case["claim"], "tags": [f"S{index}"]}
        for index, case in enumerate(cases, start=1)
    ]
    evidence = {
        f"S{index}": {"title": "Public research evidence", "text": "\n".join(case["evidence"])}
        for index, case in enumerate(cases, start=1)
    }
    run_id = f"claim-eval-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    verdicts: dict[int, dict[str, str]] = {}
    llm_results = []
    batch_reports = []
    with research_run_trace(run_id, f"Claim evaluation: {dataset.get('name')} v{dataset.get('version')}"):
        # Bounded batches reduce structured-output parse failures. The root
        # Langfuse trace correlates all calls; database telemetry is disabled
        # because this is not a registered Ada research run.
        for offset in range(0, len(claims), batch_size):
            batch = [
                {**claim, "claim_id": local_id}
                for local_id, claim in enumerate(claims[offset:offset + batch_size], start=1)
            ]
            batch_verdicts, llm_result = verify_claims_with_result(
                batch,
                evidence,
                run_id=run_id,
                persist_telemetry=False,
                prompt_version=prompt_version,
            )
            verdicts.update({offset + local_id: verdict for local_id, verdict in batch_verdicts.items()})
            if llm_result:
                llm_results.append(llm_result)
                batch_reports.append({
                    "first_case": cases[offset]["id"],
                    "case_count": len(batch),
                    "verdicts_returned": len(batch_verdicts),
                    # The claim verifier also validates a provider's equivalent
                    # top-level JSON-array response, so report the normalized
                    # outcome rather than only the gateway's initial parse.
                    "response_parsed": len(batch_verdicts) == len(batch),
                    "verdicts_complete": len(batch_verdicts) == len(batch),
                    "model": llm_result.model,
                    "latency_ms": round(llm_result.latency_ms, 2),
                    "input_tokens": llm_result.usage.input_tokens,
                    "output_tokens": llm_result.usage.output_tokens,
                    "cache_hit": llm_result.cache_hit,
                    "degraded": llm_result.degraded,
                    "response_preview": llm_result.content[:1200] if not batch_verdicts else None,
                })
    predictions = [verdicts.get(index, {}).get("verdict") for index in range(1, len(cases) + 1)]
    metrics = score_claim_verdicts([case["expected_verdict"] for case in cases], predictions)
    langfuse_enabled = os.getenv("LANGFUSE_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
    langfuse_health = _langfuse_health() if langfuse_enabled else "disabled"
    models = sorted({result.model for result in llm_results if result.model})
    total_input = sum(result.usage.input_tokens for result in llm_results)
    total_output = sum(result.usage.output_tokens for result in llm_results)
    report = {
        "benchmark": dataset.get("name"),
        "benchmark_version": dataset.get("version"),
        "prompt_version": prompt_version,
        "provenance": dataset.get("provenance"),
        "sources": dataset.get("sources", []),
        "run_id": run_id,
        "batch_size": batch_size,
        "batch_count": len(range(0, len(claims), batch_size)),
        "model": models[0] if len(models) == 1 else models,
        "latency_ms": round(sum(result.latency_ms for result in llm_results), 2),
        "tokens": {"input": total_input, "output": total_output},
        "estimated_cost_usd": round(sum(result.cost_estimate for result in llm_results), 8),
        "cache_hit": all(result.cache_hit for result in llm_results) if llm_results else None,
        "degraded": any(result.degraded for result in llm_results) if llm_results else None,
        "batches": batch_reports,
        "langfuse_enabled": langfuse_enabled,
        "langfuse_health": langfuse_health,
        "langfuse_trace_id": trace_id_for_run(run_id),
        "model_verdicts": [
            {"id": case["id"], "expected": case["expected_verdict"],
             "predicted": predictions[index], "reason": verdicts.get(index + 1, {}).get("reason")}
            for index, case in enumerate(cases)
        ],
        "metrics": metrics,
        "limitations": [
            "This narrow single-topic benchmark measures claim-verdict behavior, not end-to-end research quality or general-domain accuracy.",
            "Claim-support judgments are model outputs and require human review before being treated as labels.",
            "A missing or invalid verdict is counted as unanswered, not silently dropped.",
            "Langfuse trace delivery is not confirmed unless langfuse_health is healthy.",
        ],
    }
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered + "\n", encoding="utf-8")
    return report


def _langfuse_health() -> str:
    """Return a small status label for the configured local Langfuse endpoint."""
    base_url = os.getenv("LANGFUSE_BASE_URL", "http://localhost:3002").rstrip("/")
    request = urllib.request.Request(f"{base_url}/api/public/health", method="GET")
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return "healthy" if 200 <= response.status < 300 else f"http_{response.status}"
    except urllib.error.HTTPError as error:
        return f"http_{error.code}"
    except (urllib.error.URLError, TimeoutError, OSError):
        return "unreachable"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=ROOT / "evals" / "claim_support_benchmark.json")
    parser.add_argument("--output", type=Path, help="Optional path for the JSON result.")
    parser.add_argument("--batch-size", type=int, default=8, help="Claims per judge call (default: 8).")
    parser.add_argument(
        "--prompt-version",
        choices=("legacy-v1", "partial-calibrated-v2"),
        default=CLAIM_VERIFIER_PROMPT_VERSION,
        help="Prompt variant for a controlled verifier comparison.",
    )
    args = parser.parse_args()
    try:
        run(args.dataset, args.output, args.batch_size, args.prompt_version)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"Evaluation could not run: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
