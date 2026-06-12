import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

import { ProjectIdSchema, WorkspaceIdSchema } from "@software-analysis/core";

import { createWorkspaceLayout } from "./workspace-layout.js";

export const ProjectConfigFileSchema = z.object({
  project_schema_version: z.literal(1),
  evidence_schema_version: z.literal(1),
  artifact_schema_version: z.literal(1),
  worker_protocol_version: z.literal(1),
  id: ProjectIdSchema,
  workspace_id: WorkspaceIdSchema,
  name: z.string().min(1),
  workspace_name: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true })
});

export type ProjectConfigFile = z.infer<typeof ProjectConfigFileSchema>;

export async function readProjectConfig(projectRoot: string): Promise<ProjectConfigFile> {
  const layout = createWorkspaceLayout(projectRoot);
  const text = await readFile(layout.projectConfigPath, "utf8");
  return ProjectConfigFileSchema.parse(parse(text));
}
