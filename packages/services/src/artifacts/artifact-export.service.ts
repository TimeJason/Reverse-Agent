import type {
  Artifact,
  ArtifactStore,
  Fact,
  FactStore,
  PipelineRun,
  PipelineRunStore
} from "@software-analysis/core";
import { createId } from "@software-analysis/core";

import type { ApiEndpointData } from "../api/api-analysis.service.js";
import { redactSensitiveText } from "../evidence/text-redaction.js";

export interface ArtifactExportServiceDependencies {
  artifacts: ArtifactStore;
  facts: FactStore;
  pipelineRuns: PipelineRunStore;
  writeArtifact(path: string, content: string): Promise<string>;
}

export interface ExportArtifactInput {
  projectId: string;
  pipelineRunId?: string;
  format?: "json" | "yaml";
}

export interface ExportArtifactResult {
  artifact_id: string;
  path: string;
  warning_count: number;
  warnings: string[];
}

export class ArtifactExportService {
  constructor(private readonly deps: ArtifactExportServiceDependencies) {}

  async exportOpenApi(input: ExportArtifactInput): Promise<ExportArtifactResult> {
    const endpoints = await this.listEndpointFacts(input.projectId, input.pipelineRunId);
    const warnings = preflight(endpoints);
    const document = openApiDocument(endpoints);
    const format = input.format ?? "json";
    const content = format === "json" ? `${JSON.stringify(document, null, 2)}\n` : toYaml(document);
    const path = await this.deps.writeArtifact(`openapi-${String(Date.now())}.${format}`, content);
    const artifact = await this.deps.artifacts.save({
      id: createId("art"),
      project_id: input.projectId,
      kind: "openapi",
      artifact_schema_version: 1,
      path,
      finding_refs: [],
      ...(input.pipelineRunId === undefined ? {} : { pipeline_run_id: input.pipelineRunId }),
      metadata: {
        endpoint_count: endpoints.length,
        warning_count: warnings.length,
        format
      },
      created_at: new Date().toISOString()
    } satisfies Artifact);

    return {
      artifact_id: artifact.id,
      path: artifact.path,
      warning_count: warnings.length,
      warnings
    };
  }

  async exportMarkdown(input: ExportArtifactInput): Promise<ExportArtifactResult> {
    const endpoints = await this.listEndpointFacts(input.projectId, input.pipelineRunId);
    const warnings = preflight(endpoints);
    const content = markdownDocument(endpoints, warnings);
    const path = await this.deps.writeArtifact(`api-docs-${String(Date.now())}.md`, content);
    const artifact = await this.deps.artifacts.save({
      id: createId("art"),
      project_id: input.projectId,
      kind: "markdown",
      artifact_schema_version: 1,
      path,
      finding_refs: [],
      ...(input.pipelineRunId === undefined ? {} : { pipeline_run_id: input.pipelineRunId }),
      metadata: {
        endpoint_count: endpoints.length,
        warning_count: warnings.length
      },
      created_at: new Date().toISOString()
    } satisfies Artifact);

    return {
      artifact_id: artifact.id,
      path: artifact.path,
      warning_count: warnings.length,
      warnings
    };
  }

  private async listEndpointFacts(
    projectId: string,
    pipelineRunId: string | undefined
  ): Promise<ApiEndpointData[]> {
    const facts = await this.deps.facts.listByProject(projectId);
    if (pipelineRunId !== undefined) {
      return facts
        .filter((fact) => fact.kind === "api_endpoint")
        .filter((fact) => fact.pipeline_run_id === pipelineRunId)
        .map((fact) => fact.data as ApiEndpointData)
        .sort(compareEndpoints);
    }

    const runs = await this.deps.pipelineRuns.listByProject(projectId);
    return latestEndpointData(facts, runs).sort(compareEndpoints);
  }
}

function openApiDocument(endpoints: ApiEndpointData[]): Record<string, unknown> {
  const servers = [
    ...new Set(
      endpoints.flatMap((endpoint) =>
        (endpoint.schemes.length === 0 ? ["https"] : endpoint.schemes).map(
          (scheme) => `${scheme}://${endpoint.host}`
        )
      )
    )
  ].map((url) => ({ url }));
  const paths: Record<string, Record<string, unknown>> = {};
  const securitySchemes: Record<string, unknown> = {};

  for (const endpoint of endpoints) {
    const path = endpoint.path_template.replaceAll("{id}", "{id}");
    const pathItem = paths[path] ?? {};
    const operation: Record<string, unknown> = {
      operationId: endpoint.endpoint_id,
      parameters: path.includes("{id}")
        ? [{ name: "id", in: "path", required: true, schema: { type: "string" } }]
        : [],
      responses: responsesFor(endpoint),
      "x-analysis": {
        confidence: endpoint.confidence,
        evidence_refs: endpoint.evidence_refs,
        warnings: endpoint.warnings
      }
    };

    if (endpoint.request_schema !== undefined) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: endpoint.request_schema
          }
        }
      };
    }

    if (endpoint.auth.required) {
      operation.security = endpoint.auth.schemes.map((scheme) => ({ [scheme]: [] }));
      for (const scheme of endpoint.auth.schemes) {
        securitySchemes[scheme] = securitySchemeFor(scheme);
      }
    }

    pathItem[endpoint.method.toLowerCase()] = operation;
    paths[path] = pathItem;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Analyzed API",
      version: "0.1.0"
    },
    servers,
    paths,
    components: {
      securitySchemes
    }
  };
}

function responsesFor(endpoint: ApiEndpointData): Record<string, unknown> {
  const entries = Object.entries(endpoint.response_schemas);
  if (entries.length === 0) {
    return {
      default: {
        description: "Observed response"
      }
    };
  }

  return Object.fromEntries(
    entries.map(([status, schema]) => [
      status,
      {
        description: `Observed ${status} response`,
        content: {
          "application/json": {
            schema
          }
        }
      }
    ])
  );
}

function securitySchemeFor(scheme: string): Record<string, unknown> {
  if (scheme === "cookie_session") {
    return { type: "apiKey", in: "cookie", name: "session" };
  }
  if (scheme === "api_key_query") {
    return { type: "apiKey", in: "query", name: "api_key" };
  }
  return { type: "http", scheme: "bearer" };
}

function markdownDocument(endpoints: ApiEndpointData[], warnings: string[]): string {
  const lines = ["# API 文档", "", `生成时间：${new Date().toISOString()}`, ""];

  if (warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push("## Endpoints", "");
  for (const endpoint of endpoints) {
    lines.push(`### ${endpoint.method} ${endpoint.path_template}`, "");
    lines.push(`- Host: \`${endpoint.host}\``);
    lines.push(`- Samples: ${String(endpoint.sample_count)}`);
    lines.push(`- Confidence: ${String(endpoint.confidence)}`);
    lines.push(
      `- Auth: ${endpoint.auth.required ? endpoint.auth.schemes.join(", ") : "none observed"}`
    );
    lines.push(`- Evidence: ${endpoint.evidence_refs.map((ref) => `\`${ref}\``).join(", ")}`);
    lines.push("");
  }

  lines.push("## Workflow/Entity", "");
  lines.push("本阶段尚未执行业务流程、实体或状态机分析。", "");
  return lines.join("\n");
}

function preflight(endpoints: ApiEndpointData[]): string[] {
  const warnings: string[] = [];
  if (endpoints.length === 0) {
    warnings.push("no_endpoints_detected");
  }
  const serialized = JSON.stringify(endpoints);
  if (redactSensitiveText(serialized).redacted) {
    warnings.push("sensitive_candidate_redacted_before_export");
  }
  return warnings;
}

function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => `${pad}- ${formatYamlValue(item, indent + 2)}`).join("\n");
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${pad}${key}: ${formatYamlValue(child, indent + 2)}`)
      .join("\n");
  }
  return `${pad}${String(value)}`;
}

function formatYamlValue(value: unknown, indent: number): string {
  if (typeof value === "object" && value !== null) {
    return `\n${toYaml(value, indent)}`;
  }
  return JSON.stringify(value);
}

function compareEndpoints(a: ApiEndpointData, b: ApiEndpointData): number {
  return `${a.host} ${a.path_template} ${a.method}`.localeCompare(
    `${b.host} ${b.path_template} ${b.method}`
  );
}

function latestEndpointData(facts: Fact[], runs: PipelineRun[]): ApiEndpointData[] {
  const runTimes = new Map(runs.map((run) => [run.id, run.finished_at ?? run.updated_at]));
  const endpoints = new Map<string, ApiEndpointData>();

  for (const fact of facts
    .filter((candidate) => candidate.kind === "api_endpoint")
    .sort((a, b) => compareFactsByAnalysisTime(a, b, runTimes))) {
    const endpoint = fact.data as ApiEndpointData;
    endpoints.set(endpoint.endpoint_id, endpoint);
  }

  return [...endpoints.values()];
}

function compareFactsByAnalysisTime(a: Fact, b: Fact, runTimes: Map<string, string>): number {
  return (
    analysisSequenceForFact(a) - analysisSequenceForFact(b) ||
    analysisTimeForFact(a, runTimes).localeCompare(analysisTimeForFact(b, runTimes)) ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id)
  );
}

function analysisSequenceForFact(fact: Fact): number {
  const sequence = (fact.data as Partial<ApiEndpointData>).analysis_sequence;
  return typeof sequence === "number" ? sequence : 0;
}

function analysisTimeForFact(fact: Fact, runTimes: Map<string, string>): string {
  if (fact.pipeline_run_id !== undefined) {
    return runTimes.get(fact.pipeline_run_id) ?? fact.created_at;
  }
  return fact.created_at;
}
