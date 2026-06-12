import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  Artifact,
  ArtifactStore,
  AuditEvent,
  AuditSink,
  BlobRef,
  BlobStore,
  CaptureSession,
  CaptureSessionStore,
  Evidence,
  EvidenceSource,
  EvidenceSourceStore,
  EvidenceStore,
  Fact,
  FactStore,
  Finding,
  FindingStore,
  PipelineRun,
  PipelineRunStore
} from "@software-analysis/core";
import { describe, expect, test } from "vitest";

import {
  ApiAnalysisService,
  ArtifactExportService,
  EvidenceImportService,
  HarImportProvider
} from "../src/index.js";

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

describe("api analysis and artifact export", () => {
  test("infers endpoints, schemas, auth hints, and exports artifacts", async () => {
    const deps = createDeps();
    const content = new Uint8Array(await readFile(resolve("../../fixtures/har/login.har")));
    const importService = new EvidenceImportService({
      audit: deps.audit,
      blobStore: new MemoryBlobStore(),
      captureSessions: deps.captureSessions,
      evidence: deps.evidence,
      evidenceSources: deps.evidenceSources
    });

    await importService.import({
      projectId: "proj_demo",
      provider: new HarImportProvider(),
      content,
      mediaType: "application/json"
    });

    const analysis = new ApiAnalysisService({
      audit: deps.audit,
      evidence: deps.evidence,
      facts: deps.facts,
      findings: deps.findings,
      pipelineRuns: deps.pipelineRuns
    });
    const result = await analysis.analyzeApiSurface({ projectId: "proj_demo" });
    const rerun = await analysis.analyzeApiSurface({ projectId: "proj_demo" });
    const endpoints = await analysis.listEndpoints("proj_demo");
    const exported = new Map<string, string>();
    const exporter = new ArtifactExportService({
      artifacts: deps.artifacts,
      facts: deps.facts,
      pipelineRuns: deps.pipelineRuns,
      writeArtifact: (path: string, body: string) => {
        exported.set(path, body);
        return Promise.resolve(path);
      }
    });
    const openapi = await exporter.exportOpenApi({
      projectId: "proj_demo",
      pipelineRunId: result.pipeline_run_id
    });
    const markdown = await exporter.exportMarkdown({
      projectId: "proj_demo",
      pipelineRunId: result.pipeline_run_id
    });

    expect(result.endpoint_count).toBe(2);
    expect(rerun.endpoint_count).toBe(2);
    expect(endpoints.map((endpoint) => endpoint.path_template)).toEqual(["/login", "/orders"]);
    expect(endpoints.map((endpoint) => endpoint.schemes)).toEqual([["https"], ["https"]]);
    expect(endpoints.find((endpoint) => endpoint.path_template === "/login")?.auth.required).toBe(
      true
    );
    expect(JSON.stringify(endpoints)).not.toContain("raw-token");
    expect(openapi.warning_count).toBeGreaterThanOrEqual(0);
    expect(exported.get(openapi.path)).toContain('"openapi": "3.1.0"');
    expect(exported.get(openapi.path)).toContain('"url": "https://api.example.test"');
    expect(exported.get(markdown.path)).toContain("# API 文档");
  });

  test("redacts sensitive path segments before endpoint export", async () => {
    const deps = createDeps();
    await deps.evidence.save(
      httpEvidence("ev_sensitive_path", {
        path: "/users/alice%40example.com/reset/secret-token",
        url: "https://api.example.test/users/alice%40example.com/reset/secret-token"
      })
    );

    const analysis = new ApiAnalysisService({
      audit: deps.audit,
      evidence: deps.evidence,
      facts: deps.facts,
      findings: deps.findings,
      pipelineRuns: deps.pipelineRuns
    });
    await analysis.analyzeApiSurface({ projectId: "proj_demo" });
    const endpoints = await analysis.listEndpoints("proj_demo");
    const exported = new Map<string, string>();
    const exporter = new ArtifactExportService({
      artifacts: deps.artifacts,
      facts: deps.facts,
      pipelineRuns: deps.pipelineRuns,
      writeArtifact: (path: string, body: string) => {
        exported.set(path, body);
        return Promise.resolve(path);
      }
    });
    const openapi = await exporter.exportOpenApi({ projectId: "proj_demo" });
    const markdown = await exporter.exportMarkdown({ projectId: "proj_demo" });
    const serialized =
      JSON.stringify(endpoints) +
      (exported.get(openapi.path) ?? "") +
      (exported.get(markdown.path) ?? "");

    expect(endpoints.at(0)?.path_template).toBe("/users/{redacted}/reset/{redacted}");
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("secret-token");
  });

  test("exports only facts for the requested pipeline run", async () => {
    const deps = createDeps();
    await deps.evidence.save(
      httpEvidence("ev_run_a", { path: "/run-a", captureSessionId: "cap_a" })
    );
    await deps.evidence.save(
      httpEvidence("ev_run_b", { path: "/run-b", captureSessionId: "cap_b" })
    );

    const analysis = new ApiAnalysisService({
      audit: deps.audit,
      evidence: deps.evidence,
      facts: deps.facts,
      findings: deps.findings,
      pipelineRuns: deps.pipelineRuns
    });
    await analysis.analyzeApiSurface({ projectId: "proj_demo", captureSessionId: "cap_a" });
    const runB = await analysis.analyzeApiSurface({
      projectId: "proj_demo",
      captureSessionId: "cap_b"
    });
    const exported = new Map<string, string>();
    const exporter = new ArtifactExportService({
      artifacts: deps.artifacts,
      facts: deps.facts,
      pipelineRuns: deps.pipelineRuns,
      writeArtifact: (path: string, body: string) => {
        exported.set(path, body);
        return Promise.resolve(path);
      }
    });

    const openapi = await exporter.exportOpenApi({
      projectId: "proj_demo",
      pipelineRunId: runB.pipeline_run_id
    });
    const content = exported.get(openapi.path) ?? "";

    expect(content).toContain("/run-b");
    expect(content).not.toContain("/run-a");
  });

  test("uses the latest analysis result for repeated endpoint runs", async () => {
    const deps = createDeps();
    const analysis = new ApiAnalysisService({
      audit: deps.audit,
      evidence: deps.evidence,
      facts: deps.facts,
      findings: deps.findings,
      pipelineRuns: deps.pipelineRuns
    });

    await deps.evidence.save(httpEvidence("ev_repeat_1", { path: "/repeat", statusCode: 200 }));
    await analysis.analyzeApiSurface({ projectId: "proj_demo" });
    await deps.evidence.save(httpEvidence("ev_repeat_2", { path: "/repeat", statusCode: 404 }));
    await analysis.analyzeApiSurface({ projectId: "proj_demo" });

    const endpoints = await analysis.listEndpoints("proj_demo");

    expect(endpoints).toHaveLength(1);
    expect(endpoints.at(0)?.status_codes).toEqual([200, 404]);
  });
});

function createDeps() {
  return {
    audit: new MemoryAuditSink(),
    captureSessions: new MemoryProjectScopedStore<CaptureSession>() as CaptureSessionStore,
    evidence: new MemoryProjectScopedStore<Evidence>() as EvidenceStore,
    evidenceSources: new MemoryProjectScopedStore<EvidenceSource>() as EvidenceSourceStore,
    facts: new MemoryProjectScopedStore<Fact>() as FactStore,
    findings: new MemoryProjectScopedStore<Finding>() as FindingStore,
    pipelineRuns: new MemoryProjectScopedStore<PipelineRun>() as PipelineRunStore,
    artifacts: new MemoryProjectScopedStore<Artifact>() as ArtifactStore
  };
}

function httpEvidence(
  id: string,
  options: {
    path: string;
    url?: string;
    captureSessionId?: string;
    statusCode?: number;
  }
): Evidence {
  return {
    id,
    project_id: "proj_demo",
    source_id: "src_demo",
    ...(options.captureSessionId === undefined
      ? {}
      : { capture_session_id: options.captureSessionId }),
    kind: "http_exchange",
    schema_version: 1,
    observed_at: "2026-06-12T00:00:00.000Z",
    raw_ref: `${id}.json`,
    redaction_status: "redacted",
    summary: {
      type: "http_flow",
      method: "GET",
      url: options.url ?? `https://api.example.test${options.path}`,
      scheme: "https",
      host: "api.example.test",
      path: options.path,
      status_code: options.statusCode ?? 200,
      request_headers: {},
      response_headers: { "Content-Type": "application/json" },
      response_body: {
        size: 11,
        preview: '{"ok":true}',
        truncated: false,
        binary: false,
        media_type: "application/json"
      },
      content_type: "application/json",
      warnings: [],
      redactions: []
    }
  };
}
