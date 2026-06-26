import { z } from "zod";

import { JsonObjectSchema, NonEmptyStringSchema } from "./common.js";

export const ArtifactDiffEntrySchema = z.object({
  kind: z.enum([
    "endpoint_added",
    "endpoint_removed",
    "endpoint_changed",
    "schema_changed",
    "auth_changed",
    "status_code_changed",
    "workflow_step_changed",
    "entity_relationship_changed",
    "state_transition_changed"
  ]),
  path: NonEmptyStringSchema,
  before: JsonObjectSchema.optional(),
  after: JsonObjectSchema.optional(),
  summary: NonEmptyStringSchema
});

export const ArtifactDiffSchema = z.object({
  schema_version: z.literal(1),
  generated_at: NonEmptyStringSchema,
  before_artifact_id: NonEmptyStringSchema,
  after_artifact_id: NonEmptyStringSchema,
  entries: z.array(ArtifactDiffEntrySchema),
  ignored_fields: z.array(NonEmptyStringSchema)
});

export type ArtifactDiff = z.infer<typeof ArtifactDiffSchema>;
export type ArtifactDiffEntry = z.infer<typeof ArtifactDiffEntrySchema>;
