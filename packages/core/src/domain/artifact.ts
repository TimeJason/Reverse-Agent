import { z } from "zod";

import { ArtifactIdSchema, FindingIdSchema, PipelineRunIdSchema, ProjectIdSchema } from "../ids.js";
import { JsonObjectSchema, NonEmptyStringSchema, TimestampSchema } from "../schemas/common.js";

export const ArtifactSchema = z.object({
  id: ArtifactIdSchema,
  project_id: ProjectIdSchema,
  kind: z.enum(["openapi", "markdown", "postman", "sdk_context", "report"]),
  artifact_schema_version: z.literal(1),
  path: NonEmptyStringSchema,
  finding_refs: z.array(FindingIdSchema),
  pipeline_run_id: PipelineRunIdSchema.optional(),
  metadata: JsonObjectSchema.optional(),
  created_at: TimestampSchema
});

export type Artifact = z.infer<typeof ArtifactSchema>;
