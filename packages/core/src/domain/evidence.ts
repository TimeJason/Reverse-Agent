import { z } from "zod";

import {
  CaptureSessionIdSchema,
  EvidenceIdSchema,
  EvidenceSourceIdSchema,
  ProjectIdSchema
} from "../ids.js";
import { JsonObjectSchema, NonEmptyStringSchema, TimestampSchema } from "../schemas/common.js";

export const EvidenceSourceSchema = z.object({
  id: EvidenceSourceIdSchema,
  project_id: ProjectIdSchema,
  kind: z.enum(["har", "mitmproxy_dump", "proxy", "browser", "log", "manual"]),
  uri: NonEmptyStringSchema.optional(),
  created_at: TimestampSchema,
  metadata: JsonObjectSchema.optional()
});

export const EvidenceSchema = z.object({
  id: EvidenceIdSchema,
  project_id: ProjectIdSchema,
  source_id: EvidenceSourceIdSchema,
  capture_session_id: CaptureSessionIdSchema.optional(),
  kind: z.enum(["http_exchange", "browser_event", "log_event", "database_schema", "file"]),
  schema_version: z.literal(1),
  observed_at: TimestampSchema,
  raw_ref: NonEmptyStringSchema,
  normalized_ref: NonEmptyStringSchema.optional(),
  redaction_status: z.enum(["raw", "redacted", "failed"]),
  summary: JsonObjectSchema
});

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
