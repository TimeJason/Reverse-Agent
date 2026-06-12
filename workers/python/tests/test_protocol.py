from software_analysis_worker.protocol.messages import handle_message


def test_hello_returns_worker_capabilities() -> None:
    response = handle_message(
        {
            "jsonrpc": "2.0",
            "id": "req_1",
            "method": "hello",
            "params": {"worker_protocol_version": 1},
        }
    )

    assert response["jsonrpc"] == "2.0"
    assert response["id"] == "req_1"
    assert response["result"]["worker_protocol_version"] == 1
    assert response["result"]["capabilities"] == ["hello"]


def test_rejects_incompatible_protocol_version() -> None:
    response = handle_message(
        {
            "jsonrpc": "2.0",
            "id": "req_2",
            "method": "hello",
            "params": {"worker_protocol_version": 99},
        }
    )

    assert response["error"]["code"] == "INCOMPATIBLE_PROTOCOL"
    assert response["error"]["recoverable"] is False


def test_unknown_method_returns_structured_error() -> None:
    response = handle_message({"jsonrpc": "2.0", "id": "req_3", "method": "missing"})

    assert response["error"]["code"] == "METHOD_NOT_FOUND"
    assert response["error"]["recoverable"] is True
