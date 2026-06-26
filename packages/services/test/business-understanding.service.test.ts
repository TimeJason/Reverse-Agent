import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  Artifact,
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
  BrowserEventImportProvider,
  BusinessUnderstandingService,
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

describe("business understanding service", () => {
  test("correlates browser events and infers workflows, entities, and states", async () => {
    const deps = createDeps();
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
      content: new Uint8Array(await readFile(resolve("../../fixtures/har/checkout.har"))),
      mediaType: "application/json"
    });
    await importService.import({
      projectId: "proj_demo",
      provider: new BrowserEventImportProvider(),
      content: new Uint8Array(
        await readFile(resolve("../../fixtures/browser/checkout-events.jsonl"))
      ),
      mediaType: "application/x-ndjson"
    });
    const api = new ApiAnalysisService({
      audit: deps.audit,
      evidence: deps.evidence,
      facts: deps.facts,
      findings: deps.findings,
      pipelineRuns: deps.pipelineRuns
    });
    await api.analyzeApiSurface({ projectId: "proj_demo" });
    const business = new BusinessUnderstandingService({
      audit: deps.audit,
      evidence: deps.evidence,
      facts: deps.facts,
      findings: deps.findings,
      pipelineRuns: deps.pipelineRuns
    });

    const correlations = await business.correlateBrowserEvents({ projectId: "proj_demo" });
    const workflowResult = await business.inferWorkflows({ projectId: "proj_demo" });
    const entityResult = await business.inferBusinessEntities({ projectId: "proj_demo" });
    const stateResult = await business.inferStateTransitions({ projectId: "proj_demo" });
    const workflows = await business.listWorkflows("proj_demo");
    const entities = await business.listBusinessEntities("proj_demo");
    const transitions = await business.listStateTransitions("proj_demo");
    const runs = await deps.pipelineRuns.listByProject("proj_demo");
    const serialized = JSON.stringify({ workflows, entities, transitions });

    expect(correlations.fact_ids.length).toBeGreaterThan(0);
    expect(workflowResult.fact_ids).toHaveLength(1);
    expect(entityResult.fact_ids.length).toBeGreaterThanOrEqual(2);
    expect(stateResult.fact_ids.length).toBeGreaterThanOrEqual(3);
    expect(workflows.at(0)?.steps.length).toBeGreaterThanOrEqual(4);
    expect(workflows.at(0)?.evidence_refs.length).toBeGreaterThan(0);
    expect(workflows.at(0)?.mermaid).toContain("flowchart TD");
    expect(entities.map((entity) => entity.name)).toEqual(expect.arrayContaining(["Order"]));
    expect(transitions.some((transition) => transition.to_state === "approved")).toBe(true);
    expect(
      runs
        .filter((run) => run.name === "business-entity-inference")
        .flatMap((run) => run.input_refs)
        .every((ref) => ref.startsWith("ev_"))
    ).toBe(true);
    expect(serialized).not.toContain("password");
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
    artifacts: new MemoryProjectScopedStore<Artifact>()
  };
}
