import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { stringify } from "yaml";

import { createId } from "@software-analysis/core";

import type { ProjectConfigFile } from "./project-config-file.js";
import { createWorkspaceLayout } from "./workspace-layout.js";

export interface InitWorkspaceInput {
  name: string;
  workspaceName: string;
}

export interface InitWorkspaceResult {
  config: ProjectConfigFile;
  projectRoot: string;
}

const internalDirs = [
  "db",
  "evidence/raw",
  "evidence/normalized",
  "blobs",
  "artifacts",
  "pipelines/runs",
  "audit",
  "cache"
];

export async function initWorkspace(
  projectRoot: string,
  input: InitWorkspaceInput
): Promise<InitWorkspaceResult> {
  const layout = createWorkspaceLayout(projectRoot);

  if (await pathExists(layout.projectConfigPath)) {
    throw new Error(`Workspace is already initialized: ${layout.projectConfigPath}`);
  }

  await mkdir(layout.projectRoot, { recursive: true });

  for (const dir of internalDirs) {
    const resolved = layout.resolveInsideProject(join(".software-analysis", dir));
    await mkdir(resolved, { recursive: true });
    await writeFile(join(resolved, ".gitkeep"), "");
  }

  const now = new Date().toISOString();
  const config: ProjectConfigFile = {
    project_schema_version: 1,
    evidence_schema_version: 1,
    artifact_schema_version: 1,
    worker_protocol_version: 1,
    id: createId("proj"),
    workspace_id: createId("ws"),
    name: input.name,
    workspace_name: input.workspaceName,
    created_at: now,
    updated_at: now
  };

  await writeFile(layout.projectConfigPath, stringify(config), "utf8");

  return {
    config,
    projectRoot: layout.projectRoot
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
