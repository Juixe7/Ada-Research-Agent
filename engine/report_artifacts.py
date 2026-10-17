"""Checks whether a research run has a usable persisted report artifact.

"""

from pathlib import Path
from typing import Optional


def has_persisted_report_artifact(report_id: str, report_json_path: Optional[str] = None) -> bool:
    """Check the same durable report sources used by the report endpoint."""
    paths = [Path(report_json_path)] if report_json_path else []
    paths.append(Path("dossiers") / f"dossier_{report_id}.json")
    if any(path.is_file() for path in paths):
        return True

    try:
        from engine.storage.relational_store import RelationalStore

        dossier = RelationalStore.get_full_run_dossier(report_id)
        return bool(dossier and dossier.get("report_markdown"))
    except Exception as exc:
        print(f"[reports] Artifact availability check warning: {exc}")
        return False
