import { z } from "zod";

import { NonEmptyStringSchema } from "./common.js";

export const PluginCapabilitySchema = z.enum(["import_provider", "pipeline", "exporter"]);

export const PluginManifestSchema = z.object({
  name: NonEmptyStringSchema.regex(/^[a-z0-9][a-z0-9-]*$/),
  type: z.enum(["import_provider", "pipeline", "exporter"]),
  version: NonEmptyStringSchema,
  compatible_with: z.object({
    core: NonEmptyStringSchema
  }),
  capabilities: z.array(PluginCapabilitySchema).min(1),
  entrypoint: NonEmptyStringSchema.optional(),
  permissions: z
    .object({
      raw_evidence: z.boolean().default(false),
      network: z.boolean().default(false),
      filesystem: z.boolean().default(false)
    })
    .default({
      raw_evidence: false,
      network: false,
      filesystem: false
    })
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
