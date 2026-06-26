export const plugin = {
  name: "example-log-provider",
  capabilities: ["import_provider"],
  parse(content) {
    return String(content)
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => ({
        id: `example_log_${String(index + 1)}`,
        kind: "log_event",
        message: line,
        redaction_status: "redacted"
      }));
  }
};
