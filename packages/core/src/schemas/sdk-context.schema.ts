import { z } from "zod";

import { JsonObjectSchema, NonEmptyStringSchema } from "./common.js";

export const SdkContextEndpointSchema = z.object({
  endpoint_id: NonEmptyStringSchema,
  method: NonEmptyStringSchema,
  host: NonEmptyStringSchema,
  path_template: NonEmptyStringSchema,
  request_schema: JsonObjectSchema.optional(),
  response_schemas: z.record(z.string(), JsonObjectSchema),
  auth: JsonObjectSchema,
  evidence_refs: z.array(NonEmptyStringSchema),
  confidence: z.number().min(0).max(1),
  warnings: z.array(NonEmptyStringSchema)
});

export const SdkContextSchema = z.object({
  schema_version: z.literal(1),
  generated_at: NonEmptyStringSchema,
  project_id: NonEmptyStringSchema,
  endpoints: z.array(SdkContextEndpointSchema),
  workflows: z.array(JsonObjectSchema),
  entities: z.array(JsonObjectSchema),
  hints: z.object({
    naming: z.array(NonEmptyStringSchema),
    pagination: z.array(NonEmptyStringSchema),
    error_handling: z.array(NonEmptyStringSchema)
  }),
  warnings: z.array(NonEmptyStringSchema),
  evidence_refs: z.array(NonEmptyStringSchema)
});

export type SdkContext = z.infer<typeof SdkContextSchema>;
