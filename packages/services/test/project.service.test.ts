import { describe, expect, test } from "vitest";

import type { AuditEvent, AuditSink, Project, ProjectStore } from "@software-analysis/core";

import { ProjectService } from "../src/index.js";

class MemoryProjectStore implements ProjectStore {
  readonly projects = new Map<string, Project>();

  save(project: Project): Promise<Project> {
    this.projects.set(project.id, project);
    return Promise.resolve(project);
  }

  get(projectId: string): Promise<Project | null> {
    return Promise.resolve(this.projects.get(projectId) ?? null);
  }
}

class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

describe("project service", () => {
  test("creates projects through ports and writes an audit event", async () => {
    const projects = new MemoryProjectStore();
    const audit = new MemoryAuditSink();
    const service = new ProjectService({ audit, projects });

    const project = await service.createProject({
      name: "Demo Project",
      rootPath: "/tmp/demo",
      workspaceId: "ws_demo"
    });

    expect(project.id).toMatch(/^proj_/);
    await expect(projects.get(project.id)).resolves.toEqual(project);
    expect(audit.events.at(0)).toMatchObject({
      action: "project.create",
      project_id: project.id,
      target_id: project.id
    });
  });

  test("opens existing projects and returns structured status", async () => {
    const projects = new MemoryProjectStore();
    const service = new ProjectService({ audit: new MemoryAuditSink(), projects });
    const project = await service.createProject({
      name: "Demo Project",
      rootPath: "/tmp/demo",
      workspaceId: "ws_demo"
    });

    await expect(service.openProject(project.id)).resolves.toEqual(project);
    await expect(service.getProjectStatus(project.id)).resolves.toMatchObject({
      id: project.id,
      name: "Demo Project",
      project_schema_version: 1,
      storage: "available"
    });
  });

  test("returns structured errors for missing projects", async () => {
    const service = new ProjectService({
      audit: new MemoryAuditSink(),
      projects: new MemoryProjectStore()
    });

    await expect(service.openProject("proj_missing")).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
      recoverable: true
    });
  });
});
