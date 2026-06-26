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
  ProjectStore,
  RedactionPolicy,
  RedactionPolicyStore
} from "@software-analysis/core";
import {
  ApiAnalysisService,
  ArtifactExportService,
  BrowserEventImportProvider,
  BusinessRuleCandidateService,
  BusinessUnderstandingService,
  CaptureSessionService,
  DisabledLlmProvider,
  EvidenceImportService,
  EvidenceQueryService,
  HarImportProvider,
  LlmEnrichmentService,
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

class MemoryRedactionPolicyStore
  extends MemoryProjectScopedStore<RedactionPolicy>
  implements RedactionPolicyStore
{
  getActiveForProject(projectId: string): Promise<RedactionPolicy | null> {
    const policies = [...this.items.values()]
      .filter((policy) => policy.project_id === projectId)
      .sort((a, b) => b.version - a.version);
    return Promise.resolve(policies.at(0) ?? null);
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

  test("registers required V1 MCP tool names", () => {
    const tools = createToolDefinitions(createContext()).map((tool) => tool.name);

    expect(tools).toEqual(
      expect.arrayContaining([
        "get_project_status",
        "list_capture_sessions",
        "start_capture_session",
        "stop_capture_session",
        "get_capture_status",
        "search_traffic",
        "get_request",
        "list_hosts",
        "list_endpoints",
        "get_endpoint",
        "infer_endpoints",
        "infer_schemas",
        "infer_auth",
        "analyze_api_surface",
        "correlate_browser_events",
        "infer_workflows",
        "list_workflows",
        "get_workflow",
        "infer_business_entities",
        "get_business_entity",
        "infer_state_transitions",
        "export_openapi",
        "export_markdown_docs",
        "export_sdk_context",
        "get_redaction_policy",
        "configure_redaction",
        "scan_sensitive_data"
      ])
    );
  });

  test("audits successful, failed, and unknown MCP calls without raw input payloads", async () => {
    const ctx = createContext();

    await invokeTool(ctx, "get_project_status", {});
    await invokeTool(ctx, "get_request", {
      evidence_id: "",
      authorization: "Bearer raw"
    });
    await invokeTool(ctx, "missing_tool", { token: "raw-token" });

    const auditEvents = ctx.audit.events.filter((event) => event.action === "mcp.tool.called");
    const serialized = JSON.stringify(auditEvents);

    expect(auditEvents.map((event) => event.target_id)).toEqual([
      "get_project_status",
      "get_request",
      "missing_tool"
    ]);
    expect(auditEvents.map((event) => event.metadata.ok)).toEqual([true, false, false]);
    expect(serialized).not.toContain("Bearer raw");
    expect(serialized).not.toContain("raw-token");
  });

  test("manages local capture session lifecycle and redaction policy through MCP", async () => {
    const ctx = createContext();

    const started = await invokeTool(ctx, "start_capture_session", {
      mode: "proxy_only",
      proxy: { host: "127.0.0.1", port: 0 },
      filters: { include_hosts: ["api.example.test"] }
    });
    const sessionId = (started.structuredContent.data as { id?: string } | undefined)?.id ?? "";
    const status = await invokeTool(ctx, "get_capture_status", {
      capture_session_id: sessionId
    });
    const stopped = await invokeTool(ctx, "stop_capture_session", {
      capture_session_id: sessionId
    });
    const policy = await invokeTool(ctx, "configure_redaction", {
      mode: "strict",
      rules: ["credentials", "cookies", "supported_pii_candidates"]
    });

    expect(started.structuredContent).toMatchObject({
      ok: true,
      data: {
        status: "running",
        metadata: {
          proxy: { host: "127.0.0.1" },
          provider_status: "not_attached"
        }
      }
    });
    expect(status.structuredContent).toMatchObject({
      ok: true,
      data: { id: sessionId, status: "running" }
    });
    expect(stopped.structuredContent).toMatchObject({
      ok: true,
      data: { capture_session_id: sessionId, status: "completed" }
    });
    expect(policy.structuredContent).toMatchObject({
      ok: true,
      data: { mode: "strict", version: 1 }
    });
  });

  test("registers phase five tools and keeps LLM disabled by default", async () => {
    const ctx = createContext();
    const tools = createToolDefinitions(ctx).map((tool) => tool.name);
    const result = await invokeTool(ctx, "llm_enrich", { target: "endpoint_summary" });

    expect(tools).toEqual(
      expect.arrayContaining([
        "export_postman_collection",
        "export_sdk_context",
        "export_workflow_report",
        "export_entity_report",
        "find_business_rule_candidates",
        "list_business_rule_candidates",
        "llm_enrich"
      ])
    );
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        status: "disabled",
        provider: "disabled",
        redaction_status: "redacted"
      }
    });
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
  const redactionPolicies = new MemoryRedactionPolicyStore();
  return {
    projectId: project.id,
    readFile: () => Promise.resolve(new Uint8Array()),
    audit,
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
    businessRuleCandidateService: new BusinessRuleCandidateService({
      audit,
      evidence,
      facts,
      findings,
      pipelineRuns
    }),
    businessUnderstandingService: new BusinessUnderstandingService({
      audit,
      evidence,
      facts,
      findings,
      pipelineRuns
    }),
    captureSessionService: new CaptureSessionService({
      audit,
      captureSessions
    }),
    llmEnrichmentService: new LlmEnrichmentService({
      audit,
      facts,
      findings,
      provider: new DisabledLlmProvider()
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
    redactionPolicies,
    providers: {
      har: new HarImportProvider(),
      browser: new BrowserEventImportProvider(),
      logs: new LogImportProvider(),
      mitmproxy: new MitmproxyDumpImportProvider()
    }
  };
}
