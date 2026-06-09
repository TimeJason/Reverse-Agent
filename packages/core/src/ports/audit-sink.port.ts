import type { AuditEvent } from "../domain/audit.js";

export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
}
