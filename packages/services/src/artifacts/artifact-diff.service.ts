import type { Artifact, ArtifactStore, AuditSink } from "@software-analysis/core";
import { createId } from "@software-analysis/core";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface ArtifactDiffServiceDependencies {
  audit: AuditSink;
  artifacts: ArtifactStore;
  projectRoot: string;
  readArtifact?: (path: string) => Promise<string>;
  writeArtifact(path: string, content: string): Promise<string>;
}

export interface DiffArtifactsInput {
  projectId: string;
  beforeArtifactId: string;
  afterArtifactId: string;
}

export interface DiffArtifactsResult {
  artifact_id: string;
  path: string;
  entry_count: number;
  entries: DiffEntry[];
}

export interface DiffEntry {
  kind:
    | "endpoint_added"
    | "endpoint_removed"
    | "endpoint_changed"
    | "schema_changed"
    | "auth_changed"
    | "status_code_changed"
    | "workflow_step_changed"
    | "entity_relationship_changed"
    | "state_transition_changed";
  path: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  summary: string;
}

export class ArtifactDiffService {
  constructor(private readonly deps: ArtifactDiffServiceDependencies) {}

  async diff(input: DiffArtifactsInput): Promise<DiffArtifactsResult> {
    const before = await this.requiredArtifact(input.beforeArtifactId);
    const after = await this.requiredArtifact(input.afterArtifactId);
    const beforeJson = await this.readJson(before.path);
    const afterJson = await this.readJson(after.path);
    const entries = diffArtifacts(beforeJson, afterJson);
    const document = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      before_artifact_id: before.id,
      after_artifact_id: after.id,
      ignored_fields: ["generated_at", "created_at", "id", "artifact_id"],
      entries
    };
    const path = await this.deps.writeArtifact(
      `artifact-diff-${String(Date.now())}.json`,
      `${JSON.stringify(document, null, 2)}\n`
    );
    const artifact = await this.deps.artifacts.save({
      id: createId("art"),
      project_id: input.projectId,
      kind: "report",
      artifact_schema_version: 1,
      path,
      finding_refs: [],
      metadata: {
        report_type: "artifact_diff",
        entry_count: entries.length,
        before_artifact_id: before.id,
        after_artifact_id: after.id
      },
      created_at: new Date().toISOString()
    } satisfies Artifact);
    await this.deps.audit.append({
      id: createId("audit"),
      project_id: input.projectId,
      actor: "service",
      action: "artifact.diff",
      target_type: "artifact",
      target_id: artifact.id,
      metadata: {
        entry_count: entries.length
      },
      created_at: new Date().toISOString()
    });
    return {
      artifact_id: artifact.id,
      path,
      entry_count: entries.length,
      entries
    };
  }

  private async requiredArtifact(artifactId: string): Promise<Artifact> {
    const artifact = await this.deps.artifacts.get(artifactId);
    if (artifact === null) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    return artifact;
  }

  private async readJson(path: string): Promise<unknown> {
    if (this.deps.readArtifact !== undefined) {
      return JSON.parse(await this.deps.readArtifact(path)) as unknown;
    }
    const fullPath = resolve(this.deps.projectRoot, ".software-analysis", "artifacts", path);
    return JSON.parse(await readFile(fullPath, "utf8")) as unknown;
  }
}

function diffArtifacts(before: unknown, after: unknown): DiffEntry[] {
  const beforeEndpoints = endpointMap(before);
  const afterEndpoints = endpointMap(after);
  const entries: DiffEntry[] = [];
  for (const [key, value] of beforeEndpoints) {
    if (!afterEndpoints.has(key)) {
      entries.push({
        kind: "endpoint_removed",
        path: key,
        before: value,
        summary: `Endpoint removed: ${key}`
      });
    }
  }
  for (const [key, value] of afterEndpoints) {
    const previous = beforeEndpoints.get(key);
    if (previous === undefined) {
      entries.push({
        kind: "endpoint_added",
        path: key,
        after: value,
        summary: `Endpoint added: ${key}`
      });
      continue;
    }
    if (stableJson(previous) !== stableJson(value)) {
      entries.push({
        kind: "endpoint_changed",
        path: key,
        before: previous,
        after: value,
        summary: `Endpoint changed: ${key}`
      });
    }
  }
  return entries;
}

function endpointMap(value: unknown): Map<string, Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return new Map();
  }
  const object = value as Record<string, unknown>;
  const paths = object.paths;
  if (typeof paths === "object" && paths !== null && !Array.isArray(paths)) {
    const result = new Map<string, Record<string, unknown>>();
    for (const [path, methods] of Object.entries(paths as Record<string, unknown>)) {
      if (typeof methods !== "object" || methods === null || Array.isArray(methods)) {
        continue;
      }
      for (const [method, operation] of Object.entries(methods as Record<string, unknown>)) {
        if (isRecord(operation)) {
          result.set(`${method.toUpperCase()} ${path}`, normalize(operation));
        }
      }
    }
    return result;
  }
  const endpoints = object.endpoints;
  if (Array.isArray(endpoints)) {
    return new Map(
      endpoints
        .filter(
          (endpoint): endpoint is Record<string, unknown> =>
            typeof endpoint === "object" && endpoint !== null && !Array.isArray(endpoint)
        )
        .map((endpoint) => [
          `${readString(endpoint.method, "GET")} ${readEndpointPath(endpoint)}`,
          normalize(endpoint)
        ])
    );
  }
  return new Map();
}

function readEndpointPath(endpoint: Record<string, unknown>): string {
  return readString(endpoint.path_template ?? endpoint.path, "/");
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["id", "artifact_id", "created_at", "generated_at"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
