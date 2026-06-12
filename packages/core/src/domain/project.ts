import { z } from "zod";

import { ProjectIdSchema, WorkspaceIdSchema } from "../ids.js";
import { NonEmptyStringSchema, TimestampSchema } from "../schemas/common.js";

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  workspace_id: WorkspaceIdSchema,
  name: NonEmptyStringSchema,
  root_path: NonEmptyStringSchema,
  project_schema_version: z.literal(1),
  evidence_schema_version: z.literal(1),
  artifact_schema_version: z.literal(1),
  worker_protocol_version: z.literal(1),
  created_at: TimestampSchema,
  updated_at: TimestampSchema
});

export type Project = z.infer<typeof ProjectSchema>;
