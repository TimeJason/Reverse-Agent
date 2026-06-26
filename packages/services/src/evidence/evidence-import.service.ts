import { createHash } from "node:crypto";

import type {
  AuditSink,
  BlobRef,
  BlobStore,
  BrowserEventSummary,
  BodyView,
  CaptureSession,
  CaptureSessionStore,
  Evidence,
  EvidenceSource,
  EvidenceSourceStore,
  EvidenceStore,
  HttpFlowSummary,
  ImportFailure,
  ImportProvider,
  ImportProviderInput,
  ImportWarning,
  LogEventSummary,
  ParsedBrowserEvent,
  ParsedHttpFlow,
  ParsedLogEvent
} from "@software-analysis/core";
import { createId } from "@software-analysis/core";

import {
  createDefaultRedactionPolicy,
  redactRecord,
  type DefaultRedactionPolicy
} from "../policy/redaction-policy.service.js";
import { redactSensitiveStrings, redactSensitiveText } from "./text-redaction.js";

const PREVIEW_LIMIT_BYTES = 4096;
const binaryContentTypePattern =
  /application\/octet-stream|image\/|audio\/|video\/|font\/|application\/pdf/i;

export interface EvidenceImportServiceDependencies {
  audit: AuditSink;
  blobStore: BlobStore;
  captureSessions: CaptureSessionStore;
  evidence: EvidenceStore;
  evidenceSources: EvidenceSourceStore;
  redactionPolicy?: DefaultRedactionPolicy;
}

export interface ImportEvidenceInput {
  projectId: string;
  provider: ImportProvider;
  content: Uint8Array;
  uri?: string;
  mediaType?: string;
  options?: Record<string, unknown>;
}

export interface ImportEvidenceResult {
  source_id: string;
  capture_session_id: string;
  source_hash: string;
  evidence_count: number;
  warning_count: number;
  failure_count: number;
  warnings: ImportWarning[];
  failures: ImportFailure[];
}

export class EvidenceImportService {
  constructor(private readonly deps: EvidenceImportServiceDependencies) {}

  async import(input: ImportEvidenceInput): Promise<ImportEvidenceResult> {
    const now = new Date().toISOString();
    const sourceBlob = await this.deps.blobStore.put({
      content: input.content,
      media_type: input.mediaType ?? "application/octet-stream"
    });
    const providerInput: ImportProviderInput = {
      content: input.content,
      ...(input.mediaType === undefined ? {} : { media_type: input.mediaType }),
      ...(input.options === undefined ? {} : { options: input.options }),
      ...(input.uri === undefined ? {} : { uri: input.uri })
    };
    const parsed = await input.provider.parse(providerInput);
    const source = definedRecord({
      id: createId("src"),
      project_id: input.projectId,
      kind: input.provider.kind,
      source_hash: sourceBlob.hash,
      uri: input.uri,
      created_at: now,
      metadata: {
        blob_ref: sourceBlob.id,
        media_type: sourceBlob.media_type,
        size: sourceBlob.size
      }
    }) satisfies EvidenceSource;
    const session: CaptureSession = {
      id: createId("cap"),
      project_id: input.projectId,
      source: input.provider.kind === "log" ? "log" : "import",
      status: "running",
      started_at: now,
      metadata: {
        source_id: source.id,
        source_kind: input.provider.kind
      }
    };

    await this.deps.evidenceSources.save(source);
    await this.deps.captureSessions.save(session);

    const policy = this.deps.redactionPolicy ?? createDefaultRedactionPolicy(input.projectId);
    const allWarnings = [...parsed.warnings];

    try {
      for (const [index, item] of parsed.evidence.entries()) {
        const rawBlob = await this.writeJsonBlob(item.raw, "application/json");
        if (item.kind === "http_flow") {
          const summary = await this.createHttpSummary(item, policy, allWarnings);
          const normalizedBlob = await this.writeJsonBlob(summary, "application/json");
          await this.deps.evidence.save({
            id: createId("ev"),
            project_id: input.projectId,
            source_id: source.id,
            capture_session_id: session.id,
            kind: "http_exchange",
            schema_version: 1,
            observed_at: item.observed_at,
            raw_ref: rawBlob.id,
            normalized_ref: normalizedBlob.id,
            redaction_status: "redacted",
            summary
          } satisfies Evidence);
        } else if (item.kind === "log_event") {
          const summary = this.createLogSummary(item, policy);
          const normalizedBlob = await this.writeJsonBlob(summary, "application/json");
          await this.deps.evidence.save({
            id: createId("ev"),
            project_id: input.projectId,
            source_id: source.id,
            capture_session_id: session.id,
            kind: "log_event",
            schema_version: 1,
            observed_at: item.observed_at,
            raw_ref: rawBlob.id,
            normalized_ref: normalizedBlob.id,
            redaction_status: "redacted",
            summary
          } satisfies Evidence);
        } else {
          const summary = this.createBrowserSummary(item);
          const normalizedBlob = await this.writeJsonBlob(summary, "application/json");
          await this.deps.evidence.save({
            id: createId("ev"),
            project_id: input.projectId,
            source_id: source.id,
            capture_session_id: session.id,
            kind: "browser_event",
            schema_version: 1,
            observed_at: item.observed_at,
            raw_ref: rawBlob.id,
            normalized_ref: normalizedBlob.id,
            redaction_status: "redacted",
            summary
          } satisfies Evidence);
        }

        if (index > 0 && index % 1000 === 0) {
          allWarnings.push({
            code: "IMPORT_PROGRESS",
            message: `Imported ${String(index)} evidence items`,
            recoverable: true
          });
        }
      }

      await this.deps.captureSessions.save({
        ...session,
        status: "completed",
        ended_at: new Date().toISOString()
      });
    } catch (error) {
      await this.deps.captureSessions.save({
        ...session,
        status: "failed",
        ended_at: new Date().toISOString(),
        metadata: {
          ...session.metadata,
          error_code: "EVIDENCE_IMPORT_FAILED"
        }
      });
      await this.deps.audit.append({
        id: createId("audit"),
        project_id: input.projectId,
        actor: "service",
        action: "evidence.import.failed",
        target_type: "evidence_source",
        target_id: source.id,
        metadata: {
          capture_session_id: session.id,
          source_hash: sourceBlob.hash,
          source_kind: input.provider.kind,
          error_code: "EVIDENCE_IMPORT_FAILED"
        },
        created_at: new Date().toISOString()
      });
      throw error;
    }

    await this.deps.audit.append({
      id: createId("audit"),
      project_id: input.projectId,
      actor: "service",
      action: "evidence.import",
      target_type: "evidence_source",
      target_id: source.id,
      metadata: {
        capture_session_id: session.id,
        evidence_count: parsed.evidence.length,
        failure_count: parsed.failures.length,
        source_hash: sourceBlob.hash,
        source_kind: input.provider.kind,
        warning_count: allWarnings.length
      },
      created_at: new Date().toISOString()
    });

    return {
      source_id: source.id,
      capture_session_id: session.id,
      source_hash: sourceBlob.hash,
      evidence_count: parsed.evidence.length,
      warning_count: allWarnings.length,
      failure_count: parsed.failures.length,
      warnings: allWarnings,
      failures: parsed.failures
    };
  }

  private async createHttpSummary(
    item: ParsedHttpFlow,
    policy: DefaultRedactionPolicy,
    warnings: ImportWarning[]
  ): Promise<HttpFlowSummary> {
    const url = new URL(item.request.url);
    const requestHeaders = redactRecord(item.request.headers, policy);
    const responseHeaders = redactRecord(item.response?.headers ?? {}, policy);
    const query = redactRecord(Object.fromEntries(url.searchParams.entries()), policy);
    const redactions = [
      ...requestHeaders.redactions.map((path) => `request_headers.${path}`),
      ...responseHeaders.redactions.map((path) => `response_headers.${path}`),
      ...query.redactions.map((path) => `query.${path}`)
    ];
    const requestBody = await this.createBodyView(
      item.request.body,
      item.request.body_media_type,
      redactions,
      "request_body",
      warnings
    );
    const responseBody = await this.createBodyView(
      item.response?.body,
      item.response?.body_media_type,
      redactions,
      "response_body",
      warnings
    );
    const contentType =
      item.response?.headers["content-type"] ??
      item.response?.headers["Content-Type"] ??
      item.response?.body_media_type;

    return definedRecord({
      type: "http_flow",
      method: item.request.method.toUpperCase(),
      url: redactUrl(url, query.value),
      scheme: url.protocol.replace(/:$/, ""),
      host: url.host,
      path: url.pathname,
      query: query.value,
      status_code: item.response?.status_code,
      request_headers: requestHeaders.value,
      response_headers: responseHeaders.value,
      request_body: requestBody,
      response_body: responseBody,
      content_type: contentType,
      warnings: item.warnings.map((warning) => warning.code),
      redactions
    }) satisfies HttpFlowSummary;
  }

  private createLogSummary(item: ParsedLogEvent, policy: DefaultRedactionPolicy): LogEventSummary {
    const textRedactedFields = redactSensitiveStrings(item.fields, ["fields"]);
    const fields = redactRecord(textRedactedFields.value, policy);
    const message = redactSensitiveText(item.message);
    const redactions = [
      ...textRedactedFields.redactions,
      ...fields.redactions.map((path) => `fields.${path}`)
    ];
    if (message.redacted) {
      redactions.push("message");
    }

    return definedRecord({
      type: "log_event",
      timestamp: item.timestamp,
      level: item.level,
      service: item.service,
      message: message.value,
      trace_id: item.trace_id,
      request_id: item.request_id,
      correlation_id: item.correlation_id,
      fields: fields.value,
      warnings: item.warnings.map((warning) => warning.code),
      redactions
    }) satisfies LogEventSummary;
  }

  private createBrowserSummary(item: ParsedBrowserEvent): BrowserEventSummary {
    const textRedactions: string[] = [];
    const element =
      item.element === undefined
        ? undefined
        : redactSensitiveStrings(item.element, ["element"]).value;
    if (item.element !== undefined) {
      textRedactions.push(...redactSensitiveStrings(item.element, ["element"]).redactions);
    }
    const url = item.url === undefined ? undefined : redactSensitiveText(item.url);
    const pageUrl = item.page_url === undefined ? undefined : redactSensitiveText(item.page_url);
    const redactions = [...textRedactions];
    if (url?.redacted === true) {
      redactions.push("url");
    }
    if (pageUrl?.redacted === true) {
      redactions.push("page_url");
    }

    return definedRecord({
      type: "browser_event",
      event_type: item.event_type,
      page_url: pageUrl?.value,
      frame_id: item.frame_id,
      request_id: item.request_id,
      related_request_id: item.related_request_id,
      method: item.method?.toUpperCase(),
      url: url?.value,
      element,
      warnings: item.warnings.map((warning) => warning.code),
      redactions
    }) satisfies BrowserEventSummary;
  }

  private async createBodyView(
    content: Uint8Array | undefined,
    mediaType: string | undefined,
    redactions: string[],
    path: string,
    warnings: ImportWarning[]
  ): Promise<BodyView | undefined> {
    if (content === undefined) {
      return undefined;
    }

    const hash = createHash("sha256").update(content).digest("hex");
    const binary = binaryContentTypePattern.test(mediaType ?? "");
    const blob = await this.deps.blobStore.put({
      content,
      media_type: mediaType ?? "application/octet-stream"
    });
    const truncated = content.byteLength > PREVIEW_LIMIT_BYTES;
    let preview: string | undefined;

    if (binary) {
      warnings.push({
        code: "BINARY_BODY_PREVIEW_SKIPPED",
        message: `Binary ${path} preview skipped`,
        recoverable: true
      });
    } else {
      const decoded = new TextDecoder().decode(content);
      const redacted = redactBodyPreview(decoded);
      preview = redacted.value.slice(0, PREVIEW_LIMIT_BYTES);
      if (redacted.redacted) {
        redactions.push(`${path}.preview`);
      }
    }

    return definedRecord({
      blob_ref: blob.id,
      hash,
      media_type: mediaType,
      size: content.byteLength,
      preview,
      truncated,
      binary
    }) satisfies BodyView;
  }

  private async writeJsonBlob(value: unknown, mediaType: string): Promise<BlobRef> {
    return this.deps.blobStore.put({
      content: new TextEncoder().encode(JSON.stringify(value)),
      media_type: mediaType
    });
  }
}

function redactUrl(url: URL, redactedQuery: Record<string, string>): string {
  const next = new URL(url.toString());
  next.search = "";
  for (const [key, value] of Object.entries(redactedQuery)) {
    next.searchParams.set(key, value);
  }
  return next.toString();
}

function redactBodyPreview(value: string): { value: string; redacted: boolean } {
  try {
    const parsed = JSON.parse(value) as unknown;
    const textRedacted = redactSensitiveStrings(parsed);
    const keyRedacted = redactRecord(textRedacted.value, createDefaultRedactionPolicy("preview"));
    return {
      value: JSON.stringify(keyRedacted.value),
      redacted: textRedacted.redactions.length > 0 || keyRedacted.redactions.length > 0
    };
  } catch {
    return redactSensitiveText(value);
  }
}

function definedRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}
