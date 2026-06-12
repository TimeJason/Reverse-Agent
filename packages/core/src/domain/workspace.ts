import { z } from "zod";

import { WorkspaceIdSchema } from "../ids.js";
import { NonEmptyStringSchema, TimestampSchema } from "../schemas/common.js";

export const WorkspaceSchema = z.object({
  id: WorkspaceIdSchema,
  name: NonEmptyStringSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema
});

export type Workspace = z.infer<typeof WorkspaceSchema>;
