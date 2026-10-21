"""HTTP response schemas for report history."""

from typing import Optional

from pydantic import BaseModel


class ReportHistoryItemResponse(BaseModel):
    """One report in authenticated history or the public report directory."""

    report_id: str
    session_id: Optional[str] = None
    query: Optional[str] = None
    executive_title: Optional[str] = None
    status: Optional[str] = None
    depth: Optional[str] = None
    progress: Optional[int] = None
    stage: Optional[str] = None
    faithfulness_score: Optional[float] = None
    coverage_score: Optional[float] = None
    total_sources_cited: Optional[int] = None
    is_public: Optional[bool] = None
    created_at: Optional[str] = None


class ReportListResponse(BaseModel):
    """Report-list response preserving fields present in each visibility context."""

    reports: list[ReportHistoryItemResponse]
