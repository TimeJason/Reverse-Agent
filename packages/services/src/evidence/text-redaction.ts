const sensitiveTextPatterns = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(access_token|refresh_token|api[_-]?key|password|passwd|secret)=([^&\s]+)/gi,
  /\b(session|session_id|jwt|token)=([^;&\s]+)/gi,
  /"((?:access_token|refresh_token|api[_-]?key|password|passwd|secret|session|session_id|jwt|token))"\s*:\s*"([^"]+)"/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\+?\d[\d .-]{7,}\d)\b/g,
  /\b(?:\d[ -]*?){13,19}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
];

export function redactSensitiveText(value: string): { value: string; redacted: boolean } {
  let redacted = false;
  let output = value;

  for (const pattern of sensitiveTextPatterns) {
    output = output.replace(pattern, (_match: string, key?: string) => {
      redacted = true;
      if (key?.startsWith('"') === true) {
        return `"${key.slice(1, -1)}":"[REDACTED:credential]"`;
      }
      if (key === undefined || key.length === 0) {
        return "[REDACTED:sensitive]";
      }
      return `${key}=[REDACTED:credential]`;
    });
  }

  return { value: output, redacted };
}

export function redactSensitiveStrings<T>(
  value: T,
  path: string[] = []
): { value: T; redactions: string[] } {
  const redactions: string[] = [];
  const redacted = redactUnknownStrings(value, path, redactions);
  return { value: redacted as T, redactions };
}

function redactUnknownStrings(value: unknown, path: string[], redactions: string[]): unknown {
  if (typeof value === "string") {
    const redacted = redactSensitiveText(value);
    if (redacted.redacted) {
      redactions.push(path.join("."));
    }
    return redacted.value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactUnknownStrings(item, [...path, String(index)], redactions)
    );
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        redactUnknownStrings(child, [...path, key], redactions)
      ])
    );
  }

  return value;
}
