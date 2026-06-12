import type { AuditSink, Project, ProjectStore } from "@software-analysis/core";
import { ProjectSchema, createAnalysisError, createId } from "@software-analysis/core";

export interface ProjectServiceDependencies {
  projects: ProjectStore;
  audit: AuditSink;
}

export interface CreateProjectInput {
  name: string;
  rootPath: string;
  workspaceId: string;
}

export interface ProjectStatus {
  id: string;
  name: string;
  root_path: string;
  project_schema_version: 1;
  evidence_schema_version: 1;
  artifact_schema_version: 1;
  worker_protocol_version: 1;
  storage: "available";
}

export class ProjectService {
  constructor(private readonly deps: ProjectServiceDependencies) {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    const now = new Date().toISOString();
    const project = ProjectSchema.parse({
      id: createId("proj"),
      workspace_id: input.workspaceId,
      name: input.name,
      root_path: input.rootPath,
      project_schema_version: 1,
      evidence_schema_version: 1,
      artifact_schema_version: 1,
      worker_protocol_version: 1,
      created_at: now,
      updated_at: now
    });

    await this.deps.projects.save(project);
    await this.deps.audit.append({
      id: createId("audit"),
      project_id: project.id,
      actor: "service",
      action: "project.create",
      target_type: "project",
      target_id: project.id,
      metadata: {},
      created_at: now
    });

    return project;
  }

  async openProject(projectId: string): Promise<Project> {
    const project = await this.deps.projects.get(projectId);
    if (project === null) {
      const analysisError = createAnalysisError({
        code: "PROJECT_NOT_FOUND",
        message: `Project not found: ${projectId}`,
        recoverable: true
      });
      throw Object.assign(new Error(analysisError.message), analysisError);
    }

    return ProjectSchema.parse(project);
  }

  async getProjectStatus(projectId: string): Promise<ProjectStatus> {
    const project = await this.openProject(projectId);
    return {
      id: project.id,
      name: project.name,
      root_path: project.root_path,
      project_schema_version: project.project_schema_version,
      evidence_schema_version: project.evidence_schema_version,
      artifact_schema_version: project.artifact_schema_version,
      worker_protocol_version: project.worker_protocol_version,
      storage: "available"
    };
  }
}
