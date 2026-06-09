from __future__ import annotations

import json
import sys

from software_analysis_worker.protocol.errors import error_response
from software_analysis_worker.protocol.messages import handle_message


def main() -> None:
    for line in sys.stdin:
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                response = error_response(None, "INVALID_REQUEST", "Message must be an object", recoverable=True)
            else:
                response = handle_message(message)
        except json.JSONDecodeError as exc:
            response = error_response(
                None,
                "PARSE_ERROR",
                "Invalid JSON message",
                recoverable=True,
                details={"error": str(exc)},
            )

        sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
