import { z } from "zod";

import { AuditEventIdSchema, ProjectIdSchema } from "../ids.js";
import { JsonObjectSchema, NonEmptyStringSchema, TimestampSchema } from "../schemas/common.js";

export const AuditEventSchema = z.object({
  id: AuditEventIdSchema,
  project_id: ProjectIdSchema,
  actor: NonEmptyStringSchema,
  action: NonEmptyStringSchema,
  target_type: NonEmptyStringSchema,
  target_id: NonEmptyStringSchema,
  metadata: JsonObjectSchema,
  created_at: TimestampSchema
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
