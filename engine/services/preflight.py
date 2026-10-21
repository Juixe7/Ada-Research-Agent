"""Application service for preparing a research query against private sources."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

from engine.models import User, VaultDocument
from engine.services.errors import ServiceError


class PreflightServiceError(ServiceError):
    """Expected preflight request failure with an HTTP-compatible status."""

@dataclass(frozen=True)
class PreflightCommand:
    """Inputs used to clarify a query before dispatching research."""

    query: str
    include_user_docs: bool
    selected_docs: Optional[list[str]]
    user_modification: Optional[str]


class PreflightService:
    """Validate vault scope and build the user's query-preflight blueprint."""

    def __init__(self, evaluator: Optional[Callable[..., dict[str, Any]]] = None) -> None:
        self.evaluator = evaluator

    def evaluate(self, command: PreflightCommand, user: Optional[User], db: Session) -> dict[str, Any]:
        """Resolve only owned vault documents, then evaluate ambiguity and research angles.

        Raises:
            PreflightServiceError: The query or selected document scope is invalid.
        """
        query = command.query.strip()
        if not query or len(query) > 2000:
            raise PreflightServiceError(422, "Query must be between 1 and 2,000 characters.")
        selected_docs = command.selected_docs or []
        if len(selected_docs) > 100:
            raise PreflightServiceError(422, "Select no more than 100 vault documents.")

        docs_to_check = selected_docs if user and command.include_user_docs and selected_docs else None
        if docs_to_check and user:
            owned = {
                document.doc_name
                for document in db.query(VaultDocument).filter(
                    VaultDocument.user_id == user.id,
                    VaultDocument.doc_name.in_(docs_to_check),
                ).all()
            }
            if owned != set(docs_to_check):
                raise PreflightServiceError(404, "One or more selected vault documents were not found.")
        if command.include_user_docs and not docs_to_check and user:
            docs_to_check = [
                document.doc_name
                for document in db.query(VaultDocument).filter(VaultDocument.user_id == user.id).all()
            ]

        evaluator = self.evaluator
        if evaluator is None:
            from engine.agents.preflight import evaluate_preflight_scope
            evaluator = evaluate_preflight_scope
        return evaluator(
            query=query,
            vault_doc_names=docs_to_check,
            user_modification=command.user_modification,
            user_id=user.id if user else None,
        )
