import type { EvidenceSource } from "../domain/evidence.js";

export type ImportSourceKind = EvidenceSource["kind"];

export interface ImportWarning {
  code: string;
  message: string;
  entry?: string;
  recoverable: boolean;
}

export interface ImportFailure {
  code: string;
  message: string;
  entry?: string;
  recoverable: boolean;
}

export interface ParsedHttpFlow {
  kind: "http_flow";
  observed_at: string;
  raw: unknown;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: Uint8Array;
    body_media_type?: string;
  };
  response?: {
    status_code?: number;
    headers: Record<string, string>;
    body?: Uint8Array;
    body_media_type?: string;
  };
  warnings: ImportWarning[];
}

export interface ParsedLogEvent {
  kind: "log_event";
  observed_at: string;
  raw: string;
  timestamp: string;
  level?: string;
  service?: string;
  message: string;
  trace_id?: string;
  request_id?: string;
  correlation_id?: string;
  fields: Record<string, unknown>;
  warnings: ImportWarning[];
}

export type ParsedEvidence = ParsedHttpFlow | ParsedLogEvent;

export interface ImportProviderInput {
  uri?: string;
  content: Uint8Array;
  media_type?: string;
  options?: Record<string, unknown>;
}

export interface ImportProviderResult {
  evidence: ParsedEvidence[];
  warnings: ImportWarning[];
  failures: ImportFailure[];
}

export interface ImportProvider {
  readonly kind: ImportSourceKind;
  parse(input: ImportProviderInput): Promise<ImportProviderResult>;
}
