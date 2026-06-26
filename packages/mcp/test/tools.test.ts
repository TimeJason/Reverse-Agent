import type {
  AuditEvent,
  AuditSink,
  BlobRef,
  BlobStore,
  CaptureSession,
  Evidence,
  EvidenceSource,
  Fact,
  Finding,
  Artifact,
  PipelineRun,
  Project,
  ProjectStore
} from "@software-analysis/core";
import {
  ApiAnalysisService,
  ArtifactExportService,
  BrowserEventImportProvider,
  BusinessUnderstandingService,
  EvidenceImportService,
  EvidenceQueryService,
  HarImportProvider,
  LogImportProvider,
  MitmproxyDumpImportProvider,
  ProjectService
} from "@software-analysis/services";
import { describe, expect, test } from "vitest";

import { createToolDefinitions, invokeTool } from "../src/index.js";

class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, Uint8Array>();
  put(input: { content: Uint8Array; media_type: string }): Promise<BlobRef> {
    const id = `blob_${String(this.blobs.size + 1)}`;
    this.blobs.set(id, input.content);
    return Promise.resolve({
      id,
      hash: id,
      media_type: input.media_type,
      size: input.content.byteLength
    });
  }
  get(ref: BlobRef): Promise<Uint8Array | null> {
    return Promise.resolve(this.blobs.get(ref.id) ?? null);
  }
}

class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

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

class MemoryProjectScopedStore<T extends { id: string; project_id: string }> {
  readonly items = new Map<string, T>();
  save(item: T): Promise<T> {
    this.items.set(item.id, item);
    return Promise.resolve(item);
  }
  get(id: string): Promise<T | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }
  listByProject(projectId: string): Promise<T[]> {
    return Promise.resolve(
      [...this.items.values()].filter((item) => item.project_id === projectId)
    );
  }
}

describe("mcp tools", () => {
  test("wrap tool output in stable envelopes", async () => {
    const ctx = createContext();

    const result = await invokeTool(ctx, "get_project_status", {});

    expect(result.structuredContent).toMatchObject({
      ok: true,
      tool_schema_version: 1,
      data: { id: "proj_demo", storage: "available" }
    });
  });

  test("does not expose redaction salt or flag redacted header names as leaks", async () => {
    const ctx = createContext();

    const policy = await invokeTool(ctx, "get_redaction_policy", {});
    const scan = await invokeTool(ctx, "scan_sensitive_data", {});

    expect(JSON.stringify(policy.structuredContent)).not.toContain("salt");
    expect(scan.structuredContent).toMatchObject({
      ok: true,
      data: { leaks_detected: false }
    });
  });

  test("registers browser and business understanding tools", () => {
    const tools = createToolDefinitions(createContext()).map((tool) => tool.name);

    expect(tools).toEqual(
      expect.arrayContaining([
        "import_browser_events",
        "correlate_browser_events",
        "infer_workflows",
        "list_workflows",
        "get_workflow",
        "infer_business_entities",
        "list_business_entities",
        "get_business_entity",
        "infer_state_transitions",
        "list_state_transitions"
      ])
    );
  });
});

function createContext() {
  const project: Project = {
    id: "proj_demo",
    workspace_id: "ws_demo",
    name: "Demo",
    root_path: "/tmp/demo",
    project_schema_version: 1,
    evidence_schema_version: 1,
    artifact_schema_version: 1,
    worker_protocol_version: 1,
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z"
  };
  const projects = new MemoryProjectStore();
  void projects.save(project);
  const audit = new MemoryAuditSink();
  const captureSessions = new MemoryProjectScopedStore<CaptureSession>();
  const evidence = new MemoryProjectScopedStore<Evidence>();
  const evidenceSources = new MemoryProjectScopedStore<EvidenceSource>();
  const facts = new MemoryProjectScopedStore<Fact>();
  const findings = new MemoryProjectScopedStore<Finding>();
  const pipelineRuns = new MemoryProjectScopedStore<PipelineRun>();
  const artifacts = new MemoryProjectScopedStore<Artifact>();
  return {
    projectId: project.id,
    readFile: () => Promise.resolve(new Uint8Array()),
    projectService: new ProjectService({ audit, projects }),
    apiAnalysisService: new ApiAnalysisService({
      audit,
      evidence,
      facts,
      findings,
      pipelineRuns
    }),
    artifactExportService: new ArtifactExportService({
      artifacts,
      facts,
      pipelineRuns,
      writeArtifact: (path: string) => Promise.resolve(path)
    }),
    businessUnderstandingService: new BusinessUnderstandingService({
      audit,
      evidence,
      facts,
      findings,
      pipelineRuns
    }),
    evidenceImportService: new EvidenceImportService({
      audit,
      blobStore: new MemoryBlobStore(),
      captureSessions,
      evidence,
      evidenceSources
    }),
    evidenceQueryService: new EvidenceQueryService(evidence),
    captureSessions,
    providers: {
      har: new HarImportProvider(),
      browser: new BrowserEventImportProvider(),
      logs: new LogImportProvider(),
      mitmproxy: new MitmproxyDumpImportProvider()
    }
  };
}
