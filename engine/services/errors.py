"""Shared failure contract for application services.

Services report expected, user-actionable failures without depending on FastAPI.
The API layer translates ``status_code`` and ``detail`` into HTTP responses.
"""


class ServiceError(Exception):
    """An expected application-service failure safe to expose to an API client."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class ResearchRunServiceError(ServiceError):
    """A validation or dispatch failure while creating or managing a run."""


class ReportFollowupServiceError(ServiceError):
    """An expected failure while answering or investigating a report follow-up."""
