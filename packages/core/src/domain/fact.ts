import { z } from "zod";

import { EvidenceIdSchema, FactIdSchema, PipelineRunIdSchema, ProjectIdSchema } from "../ids.js";
import { JsonObjectSchema, NonEmptyStringSchema, TimestampSchema } from "../schemas/common.js";

export const FactSchema = z.object({
  id: FactIdSchema,
  project_id: ProjectIdSchema,
  kind: NonEmptyStringSchema,
  data: JsonObjectSchema,
  evidence_refs: z.array(EvidenceIdSchema).min(1),
  pipeline_run_id: PipelineRunIdSchema.optional(),
  created_at: TimestampSchema
});

export type Fact = z.infer<typeof FactSchema>;
