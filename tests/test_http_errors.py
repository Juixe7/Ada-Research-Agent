"""Checks the shared service-to-HTTP exception boundary."""

import pytest
from fastapi import HTTPException

from engine.http_errors import run_service_operation
from engine.services.errors import ServiceError


def test_service_error_maps_to_http_error_and_preserves_cause() -> None:
    failure = ServiceError(409, "Run is already complete.")

    def operation() -> None:
        raise failure

    with pytest.raises(HTTPException) as raised:
        run_service_operation(operation)

    assert raised.value.status_code == 409
    assert raised.value.detail == "Run is already complete."
    assert raised.value.__cause__ is failure


def test_unexpected_errors_are_not_hidden_by_the_adapter() -> None:
    failure = RuntimeError("unexpected storage failure")

    def operation() -> None:
        raise failure

    with pytest.raises(RuntimeError) as raised:
        run_service_operation(operation)

    assert raised.value is failure
