import type { AuditEvent, AuditSink } from "@software-analysis/core";

const rawSecretKeyPattern = /authorization|cookie|password|passwd|token|secret|api[-_]?key/i;

export class AuditService {
  constructor(private readonly sink: AuditSink) {}

  async append(event: AuditEvent): Promise<void> {
    if (containsRawSecret(event.metadata)) {
      throw new Error("Audit metadata appears to contain raw secret material");
    }

    await this.sink.append(event);
  }
}

function containsRawSecret(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsRawSecret(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([key, child]) => {
      if (rawSecretKeyPattern.test(key) && typeof child === "string" && child.length > 0) {
        return true;
      }
      return containsRawSecret(child);
    });
  }

  return false;
}
