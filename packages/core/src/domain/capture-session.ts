import { z } from "zod";

import { CaptureSessionIdSchema, ProjectIdSchema } from "../ids.js";
import { MetadataSchema, TimestampSchema } from "../schemas/common.js";

export const CaptureSessionSchema = z.object({
  id: CaptureSessionIdSchema,
  project_id: ProjectIdSchema,
  source: z.enum(["import", "proxy", "browser", "log", "manual"]),
  status: z.enum(["created", "running", "completed", "failed", "cancelled"]),
  started_at: TimestampSchema,
  ended_at: TimestampSchema.optional(),
  metadata: MetadataSchema.optional()
});

export type CaptureSession = z.infer<typeof CaptureSessionSchema>;
