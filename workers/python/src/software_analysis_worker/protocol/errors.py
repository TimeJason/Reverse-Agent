from __future__ import annotations

from typing import Any


def error_response(
    request_id: str | int | None,
    code: str,
    message: str,
    *,
    recoverable: bool,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {
        "code": code,
        "message": message,
        "recoverable": recoverable,
    }
    if details is not None:
        error["details"] = details

    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": error,
    }
