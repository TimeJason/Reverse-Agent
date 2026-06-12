import type { AnalysisError } from "@software-analysis/core";

export const TOOL_SCHEMA_VERSION = 1;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface ToolSuccess<T> {
  ok: true;
  tool_schema_version: 1;
  data: T;
}

export interface ToolFailure {
  ok: false;
  tool_schema_version: 1;
  error: AnalysisError;
}

export type ToolEnvelope<T> = ToolSuccess<T> | ToolFailure;

export function success<T>(data: T): ToolSuccess<T> {
  return {
    ok: true,
    tool_schema_version: TOOL_SCHEMA_VERSION,
    data
  };
}

export function failure(error: AnalysisError): ToolFailure {
  return {
    ok: false,
    tool_schema_version: TOOL_SCHEMA_VERSION,
    error
  };
}

export function serializeToolResult<T>(envelope: ToolEnvelope<T>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    structuredContent: envelope as unknown as Record<string, unknown>
  };
}

export function normalizeError(error: unknown, code = "TOOL_FAILED"): AnalysisError {
  if (isAnalysisError(error)) {
    return error;
  }
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    recoverable: true
  };
}

function isAnalysisError(value: unknown): value is AnalysisError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    "recoverable" in value
  );
}
