import { z } from "zod";

import { ProjectIdSchema, RedactionPolicyIdSchema } from "../ids.js";
import { NonEmptyStringSchema, TimestampSchema } from "../schemas/common.js";

export const RedactionPolicySchema = z.object({
  id: RedactionPolicyIdSchema,
  project_id: ProjectIdSchema,
  version: z.number().int().positive(),
  mode: z.enum(["default", "strict", "custom"]),
  rules: z.array(NonEmptyStringSchema),
  created_at: TimestampSchema
});

export type RedactionPolicy = z.infer<typeof RedactionPolicySchema>;
