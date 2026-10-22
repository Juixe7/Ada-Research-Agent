"""Translate application-service failures into HTTP responses at API boundaries."""

from __future__ import annotations

from collections.abc import Callable
from typing import ParamSpec, TypeVar

from fastapi import HTTPException

from engine.services.errors import ServiceError

Params = ParamSpec("Params")
Result = TypeVar("Result")


def run_service_operation(
    operation: Callable[Params, Result],
    /,
    *args: Params.args,
    **kwargs: Params.kwargs,
) -> Result:
    """Run a service call and map expected domain failures to HTTP errors.

    Unexpected exceptions propagate unchanged so FastAPI can report a server
    error and the original failure remains visible in logs.
    """
    try:
        return operation(*args, **kwargs)
    except ServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
