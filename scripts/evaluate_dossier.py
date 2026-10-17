"""Run deterministic citation-reference checks against one or more saved dossiers."""

import argparse
import glob
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engine.guards.citation_guard import CITATION_REGEX, verify_and_ground_citations  # noqa: E402


def evaluate(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as dossier_file:
        dossier = json.load(dossier_file)
    markdown = dossier.get("report_markdown") or dossier.get("monograph") or ""
    evidence = dossier.get("evidence_manifest") or []
    if not markdown:
        raise ValueError("Dossier has no report_markdown or monograph.")
    result = verify_and_ground_citations(markdown, evidence)
    valid_ids = {item.get("source_id") for item in evidence if item.get("source_id")}
    references = CITATION_REGEX.findall(markdown)
    total = len(references)
    valid = sum(reference in valid_ids for reference in references)
    return {
        "file": str(path),
        "topic": dossier.get("query") or dossier.get("topic"),
        "evidence_sources": len({item.get("source_id") for item in evidence if item.get("source_id")}),
        "citation_references": total,
        "valid_citation_references": valid,
        "citation_reference_precision": round(valid / total, 4) if total else None,
        "unique_citations_valid": result["unique_valid_sources_cited"],
        "phantom_citations": result["hallucinated_ids"],
        "claims_rejected_for_phantom_citations": result["rejected_claims_count"],
        "claim_entailment_evaluated": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths", nargs="*", help="Dossier JSON paths (defaults to dossiers/dossier_*.json)."
    )
    parser.add_argument("--json-out", type=Path, help="Also save the result as JSON.")
    args = parser.parse_args()

    paths = [Path(path) for path in args.paths] or [Path(path) for path in sorted(glob.glob(str(ROOT / "dossiers" / "dossier_*.json")))]
    if not paths:
        print("No dossier JSON files found. Pass a saved dossier path to evaluate.", file=sys.stderr)
        return 2

    reports: List[Dict[str, Any]] = []
    for path in paths:
        try:
            reports.append(evaluate(path))
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            print(f"Could not evaluate {path}: {exc}", file=sys.stderr)
            return 2

    total_refs = sum(item["citation_references"] for item in reports)
    valid_refs = sum(item["valid_citation_references"] for item in reports)
    aggregate = {
        "reports_evaluated": len(reports),
        "citation_reference_precision": round(valid_refs / total_refs, 4) if total_refs else None,
        "citation_references": total_refs,
        "valid_citation_references": valid_refs,
        "reports_with_phantom_citations": sum(bool(item["phantom_citations"]) for item in reports),
        "scope_note": "Checks citation IDs against each saved evidence manifest. It does not measure whether cited text entails each claim.",
        "reports": reports,
    }
    output = json.dumps(aggregate, indent=2, ensure_ascii=False)
    print(output)
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(output + "\n", encoding="utf-8")
    return 1 if aggregate["reports_with_phantom_citations"] or not total_refs else 0


if __name__ == "__main__":
    raise SystemExit(main())
