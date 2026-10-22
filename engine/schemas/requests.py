"""Validated request DTOs used by Ada's research and document APIs."""

from typing import Optional

from pydantic import BaseModel, Field


class PreflightRequest(BaseModel):
    """Query and optional vault context used to prepare a research run."""

    query: str = Field(..., min_length=1, max_length=2000)
    depth: str = "deep"
    include_user_docs: bool = True
    selected_docs: Optional[list[str]] = None
    user_modification: Optional[str] = Field(None, max_length=1000)


class ResearchRequest(BaseModel):
    """Validated configuration for an asynchronous research run."""

    query: str = Field(..., min_length=1, max_length=2000)
    depth: str = "deep"
    include_user_docs: bool = True
    selected_docs: Optional[list[str]] = None
    clarification_choice: Optional[str] = None
    custom_angles: Optional[list[str]] = Field(None, max_length=12)
    session_id: Optional[str] = None
    blocked_domains: Optional[list[str]] = None


class PasteDocRequest(BaseModel):
    """Title and text for a pasted vault document."""

    title: str = Field(..., min_length=1, max_length=255)
    text: str = Field(..., min_length=1, max_length=20 * 1024 * 1024)


class ReportFollowupRequest(BaseModel):
    """Evidence-grounded follow-up question for a completed report."""

    question: str = Field(..., min_length=1, max_length=1000)
    selected_text: Optional[str] = Field("", max_length=500)


class AddendumRequest(BaseModel):
    """Inquiry and context for a focused report addendum investigation."""

    inquiry: str = Field(..., min_length=1, max_length=1000)
    selected_text: Optional[str] = Field("", max_length=500)
    context: Optional[str] = Field("", max_length=2000)


class QuerySourceRequest(BaseModel):
    """Question constrained to a source in the report evidence manifest."""

    source_id: str = Field(..., min_length=1, max_length=20)
    question: str = Field(..., min_length=1, max_length=1000)
