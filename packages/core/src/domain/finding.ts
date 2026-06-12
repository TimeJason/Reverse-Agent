import { z } from "zod";

import {
  EvidenceIdSchema,
  FactIdSchema,
  FindingIdSchema,
  PipelineRunIdSchema,
  ProjectIdSchema
} from "../ids.js";
import { JsonObjectSchema, NonEmptyStringSchema, TimestampSchema } from "../schemas/common.js";

export const FindingSchema = z.object({
  id: FindingIdSchema,
  project_id: ProjectIdSchema,
  kind: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  description: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence_refs: z.array(EvidenceIdSchema).min(1),
  fact_refs: z.array(FactIdSchema).optional(),
  pipeline_run_id: PipelineRunIdSchema.optional(),
  data: JsonObjectSchema.optional(),
  created_at: TimestampSchema
});

export type Finding = z.infer<typeof FindingSchema>;
