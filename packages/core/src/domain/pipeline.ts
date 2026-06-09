import { z } from "zod";

import { EvidenceIdSchema, PipelineRunIdSchema, ProjectIdSchema } from "../ids.js";
import { JsonObjectSchema, NonEmptyStringSchema, TimestampSchema } from "../schemas/common.js";

export const PipelineRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);

export const PipelineRunSchema = z.object({
  id: PipelineRunIdSchema,
  project_id: ProjectIdSchema,
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  status: PipelineRunStatusSchema,
  input_refs: z.array(EvidenceIdSchema),
  output_ids: z.array(NonEmptyStringSchema),
  warnings: z.array(NonEmptyStringSchema),
  metrics: JsonObjectSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  started_at: TimestampSchema.optional(),
  finished_at: TimestampSchema.optional(),
  error_code: NonEmptyStringSchema.optional()
});

export type PipelineRunStatus = z.infer<typeof PipelineRunStatusSchema>;
export type PipelineRun = z.infer<typeof PipelineRunSchema>;
