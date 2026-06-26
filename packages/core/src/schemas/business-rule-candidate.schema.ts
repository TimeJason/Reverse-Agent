import { z } from "zod";

import { JsonObjectSchema, NonEmptyStringSchema } from "./common.js";

export const BusinessRuleCandidateSchema = z.object({
  rule_id: NonEmptyStringSchema,
  origin: z.literal("business-rule-candidate"),
  status: z.literal("candidate"),
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  confidence: z.number().min(0).max(1),
  positive_evidence_refs: z.array(NonEmptyStringSchema),
  counter_evidence_refs: z.array(NonEmptyStringSchema),
  evidence_refs: z.array(NonEmptyStringSchema).min(1),
  signals: z.array(
    z.object({
      kind: NonEmptyStringSchema,
      detail: JsonObjectSchema,
      evidence_refs: z.array(NonEmptyStringSchema).min(1)
    })
  ),
  unresolved_items: z.array(
    z.object({
      reason: NonEmptyStringSchema,
      evidence_refs: z.array(NonEmptyStringSchema),
      suggested_action: NonEmptyStringSchema
    })
  ),
  pipeline_run_id: NonEmptyStringSchema
});

export type BusinessRuleCandidate = z.infer<typeof BusinessRuleCandidateSchema>;
