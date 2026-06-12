import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  AuditEvent,
  AuditSink,
  BlobRef,
  BlobStore,
  CaptureSession,
  CaptureSessionStore,
  Evidence,
  EvidenceSource,
  EvidenceSourceStore,
  EvidenceStore
} from "@software-analysis/core";
import { describe, expect, test } from "vitest";

import {
  EvidenceImportService,
  EvidenceQueryService,
  HarImportProvider,
  LogImportProvider
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

class MemoryProjectStore<T extends { id: string; project_id: string }> {
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

describe("evidence import service", () => {
  test("imports HAR as redacted HTTP evidence and supports traffic queries", async () => {
    const deps = createDeps();
    const service = new EvidenceImportService(deps);
    const content = new Uint8Array(await readFile(resolve("../../fixtures/har/login.har")));

    const result = await service.import({
      projectId: "proj_demo",
      provider: new HarImportProvider(),
      content,
      uri: "fixtures/har/login.har",
      mediaType: "application/json"
    });
    const query = new EvidenceQueryService(deps.evidence);
    const traffic = await query.searchTraffic({
      project_id: "proj_demo",
      host: "api.example.test"
    });
    const serialized = JSON.stringify(traffic.items);

    expect(result.evidence_count).toBe(2);
    expect(traffic.items).toHaveLength(2);
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("raw-cookie");
    expect(serialized).not.toContain("body-secret");
    expect(serialized).toContain("[REDACTED:credential]");
    expect(deps.audit.events.at(0)?.metadata).toMatchObject({ evidence_count: 2 });
  });

  test("imports JSONL logs as redacted log evidence", async () => {
    const deps = createDeps();
    const service = new EvidenceImportService(deps);
    const content = new Uint8Array(await readFile(resolve("../../fixtures/logs/app.jsonl")));

    const result = await service.import({
      projectId: "proj_demo",
      provider: new LogImportProvider(),
      content,
      uri: "fixtures/logs/app.jsonl",
      mediaType: "text/plain",
      options: { format: "jsonl" }
    });
    const logs = await new EvidenceQueryService(deps.evidence).searchLogs({
      project_id: "proj_demo",
      service: "orders"
    });
    const serialized = JSON.stringify(logs.items);

    expect(result.evidence_count).toBe(2);
    expect(logs.items).toHaveLength(2);
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("raw-key");
  });

  test("redacts secrets before truncating large body previews", async () => {
    const deps = createDeps();
    const service = new EvidenceImportService(deps);
    const padding = "x".repeat(5000);
    const har = {
      log: {
        entries: [
          {
            startedDateTime: "2026-06-12T00:00:00.000Z",
            request: {
              method: "POST",
              url: "https://api.example.test/large",
              headers: [{ name: "Content-Type", value: "application/json" }],
              postData: {
                mimeType: "application/json",
                text: JSON.stringify({ padding, access_token: "large-body-token" })
              }
            },
            response: { status: 204, headers: [], content: { mimeType: "text/plain", text: "" } }
          }
        ]
      }
    };

    await service.import({
      projectId: "proj_demo",
      provider: new HarImportProvider(),
      content: new TextEncoder().encode(JSON.stringify(har)),
      mediaType: "application/json"
    });

    const traffic = await new EvidenceQueryService(deps.evidence).searchTraffic({
      project_id: "proj_demo"
    });

    expect(JSON.stringify(traffic.items)).not.toContain("large-body-token");
  });

  test("falls back for non-object JSONL lines instead of aborting import", async () => {
    const deps = createDeps();
    const service = new EvidenceImportService(deps);

    const result = await service.import({
      projectId: "proj_demo",
      provider: new LogImportProvider(),
      content: new TextEncoder().encode('"plain string json"\n'),
      mediaType: "text/plain",
      options: { format: "jsonl" }
    });

    expect(result.evidence_count).toBe(1);
    expect(result.warning_count).toBe(1);
  });
});

function createDeps() {
  return {
    audit: new MemoryAuditSink(),
    blobStore: new MemoryBlobStore(),
    captureSessions: new MemoryProjectStore<CaptureSession>() as CaptureSessionStore,
    evidence: new MemoryProjectStore<Evidence>() as EvidenceStore,
    evidenceSources: new MemoryProjectStore<EvidenceSource>() as EvidenceSourceStore
  };
}
