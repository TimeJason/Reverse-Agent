import { AuditEventSchema } from "@software-analysis/core";
import type { AuditEvent, AuditEventStore } from "@software-analysis/core";

import type { SqliteClient } from "../sqlite-client.js";

interface PayloadRow {
  payload_json: string;
}

export class SqliteAuditEventRepository implements AuditEventStore {
  constructor(private readonly client: SqliteClient) {}

  append(event: AuditEvent): Promise<void> {
    this.client
      .prepare(
        `insert into audit_events (id, project_id, action, created_at, payload_json)
         values (@id, @project_id, @action, @created_at, @payload_json)`
      )
      .run({
        id: event.id,
        project_id: event.project_id,
        action: event.action,
        created_at: event.created_at,
        payload_json: JSON.stringify(event)
      });
    return Promise.resolve();
  }

  listByProject(projectId: string): Promise<AuditEvent[]> {
    const rows = this.client
      .prepare(
        `select payload_json from audit_events
         where project_id = ?
         order by created_at asc, id asc`
      )
      .all(projectId);

    return Promise.resolve(rows.map((row) => parseRow(row)));
  }
}

function parseRow(row: unknown): AuditEvent {
  if (!isPayloadRow(row)) {
    throw new Error("Unexpected audit event row shape");
  }
  return AuditEventSchema.parse(JSON.parse(row.payload_json));
}

function isPayloadRow(row: unknown): row is PayloadRow {
  return (
    typeof row === "object" &&
    row !== null &&
    "payload_json" in row &&
    typeof row.payload_json === "string"
  );
}
