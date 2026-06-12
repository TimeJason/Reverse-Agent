from __future__ import annotations

from typing import Any

from software_analysis_worker.protocol.errors import error_response

WORKER_PROTOCOL_VERSION = 1


def handle_message(message: dict[str, Any]) -> dict[str, Any]:
    request_id = message.get("id")
    method = message.get("method")

    if method == "hello":
        return _handle_hello(request_id, message.get("params"))

    return error_response(
        request_id,
        "METHOD_NOT_FOUND",
        f"Unknown worker method: {method}",
        recoverable=True,
    )


def _handle_hello(request_id: str | int | None, params: object) -> dict[str, Any]:
    requested_version = _requested_protocol_version(params)
    if requested_version != WORKER_PROTOCOL_VERSION:
        return error_response(
            request_id,
            "INCOMPATIBLE_PROTOCOL",
            f"Unsupported worker protocol version: {requested_version}",
            recoverable=False,
            details={"supported_worker_protocol_version": WORKER_PROTOCOL_VERSION},
        )

    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {
            "worker_protocol_version": WORKER_PROTOCOL_VERSION,
            "capabilities": ["hello"],
        },
    }


def _requested_protocol_version(params: object) -> int | None:
    if isinstance(params, dict):
        value = params.get("worker_protocol_version")
        if isinstance(value, int):
            return value
    return None
