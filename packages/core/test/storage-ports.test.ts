import { describe, expect, test } from "vitest";

import type {
  AuditEvent,
  AuditEventStore,
  BlobRef,
  BlobStore,
  Project,
  ProjectStore
} from "../src/index.js";

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

class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, Uint8Array>();

  put(input: { content: Uint8Array; media_type: string }): Promise<BlobRef> {
    const nextId = String(this.blobs.size + 1);
    const ref: BlobRef = {
      id: `blob_${nextId}`,
      hash: `hash_${nextId}`,
      media_type: input.media_type,
      size: input.content.byteLength
    };
    this.blobs.set(ref.id, input.content);
    return Promise.resolve(ref);
  }

  get(ref: BlobRef): Promise<Uint8Array | null> {
    return Promise.resolve(this.blobs.get(ref.id) ?? null);
  }
}

class MemoryAuditStore implements AuditEventStore {
  readonly events: AuditEvent[] = [];

  append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  listByProject(projectId: string): Promise<AuditEvent[]> {
    return Promise.resolve(this.events.filter((event) => event.project_id === projectId));
  }
}

describe("storage ports", () => {
  test("allow services to use in-memory project stores", async () => {
    const store = new MemoryProjectStore();
    const project: Project = {
      id: "proj_demo",
      workspace_id: "ws_demo",
      name: "Demo Project",
      root_path: "/tmp/demo",
      project_schema_version: 1,
      evidence_schema_version: 1,
      artifact_schema_version: 1,
      worker_protocol_version: 1,
      created_at: "2026-06-09T00:00:00.000Z",
      updated_at: "2026-06-09T00:00:00.000Z"
    };

    await store.save(project);

    await expect(store.get(project.id)).resolves.toEqual(project);
  });

  test("keeps blob content behind a blob store boundary", async () => {
    const store = new MemoryBlobStore();

    const ref = await store.put({
      content: new TextEncoder().encode("secret"),
      media_type: "text/plain"
    });

    expect(ref).toMatchObject({ media_type: "text/plain", size: 6 });
    await expect(store.get(ref)).resolves.toEqual(new TextEncoder().encode("secret"));
  });

  test("allows audit events to be appended without exposing persistence rows", async () => {
    const audit = new MemoryAuditStore();

    await audit.append({
      id: "audit_demo",
      project_id: "proj_demo",
      actor: "cli",
      action: "project.create",
      target_type: "project",
      target_id: "proj_demo",
      metadata: {},
      created_at: "2026-06-09T00:00:00.000Z"
    });

    expect(audit.events).toHaveLength(1);
  });
});
