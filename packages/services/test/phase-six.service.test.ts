import type {
  Artifact,
  AuditEvent,
  AuditSink,
  CaptureSession,
  Evidence,
  Fact,
  PipelineRun
} from "@software-analysis/core";
import { describe, expect, test } from "vitest";

import {
  ArtifactDiffService,
  BenchmarkManifestService,
  DiagnosticsService,
  PluginHarnessService
} from "../src/index.js";

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

describe("phase six stability and plugin services", () => {
  test("creates structured artifact diff and ignores non-semantic fields", async () => {
    const deps = createDeps();
    const files = new Map<string, string>();
    await deps.artifacts.save(artifact("art_before", "before.json"));
    await deps.artifacts.save(artifact("art_after", "after.json"));
    files.set(
      "before.json",
      JSON.stringify({
        openapi: "3.1.0",
        paths: {
          "/orders": {
            get: {
              id: "random-before",
              generated_at: "2026-06-26T00:00:00.000Z",
              responses: { "200": { description: "OK" } }
            }
          }
        }
      })
    );
    files.set(
      "after.json",
      JSON.stringify({
        openapi: "3.1.0",
        paths: {
          "/orders": {
            get: {
              id: "random-after",
              generated_at: "2026-06-26T01:00:00.000Z",
              responses: { "200": { description: "OK" } }
            }
          },
          "/checkout": {
            post: {
              responses: { "201": { description: "Created" } }
            }
          }
        }
      })
    );
    const writes = new Map<string, string>();
    const service = new ArtifactDiffService({
      audit: deps.audit,
      artifacts: deps.artifacts,
      projectRoot: "/virtual/project",
      readArtifact: (path) => Promise.resolve(files.get(path) ?? "{}"),
      writeArtifact: (path, content) => {
        writes.set(path, content);
        return Promise.resolve(path);
      }
    });

    const result = await service.diff({
      projectId: "proj_demo",
      beforeArtifactId: "art_before",
      afterArtifactId: "art_after"
    });

    expect(result.entries).toEqual([
      expect.objectContaining({
        kind: "endpoint_added",
        path: "POST /checkout"
      })
    ]);
    expect(result.entry_count).toBe(1);
    expect(writes.get(result.path)).toContain('"ignored_fields"');
    expect([...deps.artifacts.items.values()].some((item) => item.kind === "report")).toBe(true);
    expect(deps.audit.events.map((event) => event.action)).toContain("artifact.diff");
  });

  test("reports local diagnostics without telemetry and audits failed runs", async () => {
    const deps = createDeps();
    await deps.evidence.save({
      id: "ev_demo",
      project_id: "proj_demo",
      source_id: "src_demo",
      kind: "http_exchange",
      schema_version: 1,
      observed_at: "2026-06-26T00:00:00.000Z",
      raw_ref: "blob_raw",
      redaction_status: "redacted",
      summary: { token: "[redacted]" }
    });
    await deps.pipelineRuns.save({
      id: "run_failed",
      project_id: "proj_demo",
      name: "api-analysis",
      version: "0.1.0",
      status: "failed",
      input_refs: [],
      output_ids: [],
      warnings: [],
      metrics: {},
      created_at: "2026-06-26T00:00:00.000Z",
      updated_at: "2026-06-26T00:01:00.000Z"
    });
    const service = new DiagnosticsService({
      audit: deps.audit,
      artifacts: deps.artifacts,
      captureSessions: deps.captureSessions,
      evidence: deps.evidence,
      facts: deps.facts,
      pipelineRuns: deps.pipelineRuns
    });

    const report = await service.run("proj_demo");
    const serialized = JSON.stringify(report);

    expect(report.telemetry).toBe("disabled");
    expect(report.metrics.failed_pipeline_runs).toBe(1);
    const pipelineCheck = report.checks.find((check) => check.name === "pipeline_runs");

    expect(pipelineCheck?.ok).toBe(false);
    expect(pipelineCheck?.severity).toBe("warning");
    expect(typeof pipelineCheck?.recommendation).toBe("string");
    expect(serialized).not.toContain("raw-token");
    expect(deps.audit.events.map((event) => event.action)).toContain("diagnostics.run");
  });

  test("validates plugin manifests with compatibility and raw evidence guardrails", async () => {
    const deps = createDeps();
    const service = new PluginHarnessService({
      audit: deps.audit,
      coreVersion: "0.1.0"
    });
    const baseManifest = {
      name: "example-log-provider",
      type: "import_provider",
      version: "0.1.0",
      compatible_with: { core: ">=1.0 <2.0" },
      capabilities: ["import_provider"]
    };

    const accepted = await service.validate("proj_demo", baseManifest);
    const rawRejected = await service.validate("proj_demo", {
      ...baseManifest,
      name: "raw-reader",
      permissions: { raw_evidence: true }
    });
    const incompatible = await service.validate("proj_demo", {
      ...baseManifest,
      compatible_with: { core: "^2.0.0" }
    });
    const networkWarning = await service.validate("proj_demo", {
      ...baseManifest,
      permissions: { network: true }
    });

    expect(accepted.ok).toBe(true);
    expect(accepted.manifest?.permissions.raw_evidence).toBe(false);
    expect(rawRejected.ok).toBe(false);
    expect(rawRejected.errors.join("\n")).toContain("raw evidence");
    expect(incompatible.ok).toBe(false);
    expect(incompatible.errors.join("\n")).toContain("not compatible");
    expect(networkWarning.ok).toBe(true);
    expect(networkWarning.warnings.join("\n")).toContain("network permission");
    expect(deps.audit.events.map((event) => event.action)).toEqual(
      expect.arrayContaining(["plugin.validate.accepted", "plugin.validate.rejected"])
    );
  });

  test("creates benchmark manifest with S/M/L profiles and full metadata retention", () => {
    const manifest = new BenchmarkManifestService().createDefaultManifest();

    expect(manifest.schema_version).toBe(1);
    expect(manifest.profiles.map((profile) => profile.name)).toEqual(["S", "M", "L"]);
    expect(manifest.profiles.at(-1)?.requests).toBe(1_000_000);
    expect(manifest.profiles.every((profile) => profile.min_metadata_retention_ratio === 1)).toBe(
      true
    );
  });
});

function createDeps() {
  return {
    audit: new MemoryAuditSink(),
    captureSessions: new MemoryProjectScopedStore<CaptureSession>(),
    evidence: new MemoryProjectScopedStore<Evidence>(),
    facts: new MemoryProjectScopedStore<Fact>(),
    pipelineRuns: new MemoryProjectScopedStore<PipelineRun>(),
    artifacts: new MemoryProjectScopedStore<Artifact>()
  };
}

function artifact(id: string, path: string): Artifact {
  return {
    id,
    project_id: "proj_demo",
    kind: "openapi",
    artifact_schema_version: 1,
    path,
    finding_refs: [],
    created_at: "2026-06-26T00:00:00.000Z"
  };
}
