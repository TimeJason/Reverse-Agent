import { z } from "zod";

import { NonEmptyStringSchema } from "./common.js";

export const BenchmarkManifestSchema = z.object({
  schema_version: z.literal(1),
  generated_at: NonEmptyStringSchema,
  profiles: z.array(
    z.object({
      name: z.enum(["S", "M", "L"]),
      requests: z.number().int().positive(),
      max_duration_ms: z.number().int().positive(),
      max_memory_mb: z.number().int().positive(),
      min_metadata_retention_ratio: z.number().min(0).max(1)
    })
  )
});

export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;
