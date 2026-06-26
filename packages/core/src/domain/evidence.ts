import { z } from "zod";

import {
  CaptureSessionIdSchema,
  EvidenceIdSchema,
  EvidenceSourceIdSchema,
  ProjectIdSchema
} from "../ids.js";
import { JsonObjectSchema, NonEmptyStringSchema, TimestampSchema } from "../schemas/common.js";

export const HeaderRecordSchema = z.record(z.string(), z.string());

export const BodyViewSchema = z.object({
  blob_ref: NonEmptyStringSchema.optional(),
  hash: NonEmptyStringSchema.optional(),
  media_type: NonEmptyStringSchema.optional(),
  size: z.number().int().nonnegative(),
  preview: z.string().optional(),
  truncated: z.boolean(),
  binary: z.boolean()
});

export const HttpFlowSummarySchema = z.object({
  type: z.literal("http_flow"),
  method: NonEmptyStringSchema,
  url: NonEmptyStringSchema,
  scheme: NonEmptyStringSchema.optional(),
  host: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  query: z.record(z.string(), z.string()).optional(),
  status_code: z.number().int().min(100).max(599).optional(),
  request_headers: HeaderRecordSchema,
  response_headers: HeaderRecordSchema,
  request_body: BodyViewSchema.optional(),
  response_body: BodyViewSchema.optional(),
  content_type: z.string().optional(),
  warnings: z.array(NonEmptyStringSchema),
  redactions: z.array(NonEmptyStringSchema)
});

export const LogEventSummarySchema = z.object({
  type: z.literal("log_event"),
  timestamp: TimestampSchema,
  level: z.string().optional(),
  service: z.string().optional(),
  message: z.string(),
  trace_id: z.string().optional(),
  request_id: z.string().optional(),
  correlation_id: z.string().optional(),
  fields: JsonObjectSchema,
  warnings: z.array(NonEmptyStringSchema),
  redactions: z.array(NonEmptyStringSchema)
});

export const BrowserElementSummarySchema = z.object({
  text: z.string().optional(),
  accessible_name: z.string().optional(),
  input_name: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional()
});

export const BrowserEventSummarySchema = z.object({
  type: z.literal("browser_event"),
  event_type: z.enum(["navigation", "click", "input", "submit", "network"]),
  page_url: z.string().optional(),
  frame_id: z.string().optional(),
  request_id: z.string().optional(),
  related_request_id: z.string().optional(),
  method: z.string().optional(),
  url: z.string().optional(),
  element: BrowserElementSummarySchema.optional(),
  warnings: z.array(NonEmptyStringSchema),
  redactions: z.array(NonEmptyStringSchema)
});

export const EvidenceSourceSchema = z.object({
  id: EvidenceSourceIdSchema,
  project_id: ProjectIdSchema,
  kind: z.enum(["har", "mitmproxy_dump", "proxy", "browser", "log", "manual"]),
  source_hash: NonEmptyStringSchema.optional(),
  uri: NonEmptyStringSchema.optional(),
  created_at: TimestampSchema,
  metadata: JsonObjectSchema.optional()
});

export const EvidenceSchema = z.object({
  id: EvidenceIdSchema,
  project_id: ProjectIdSchema,
  source_id: EvidenceSourceIdSchema,
  capture_session_id: CaptureSessionIdSchema.optional(),
  kind: z.enum(["http_exchange", "browser_event", "log_event", "database_schema", "file"]),
  schema_version: z.literal(1),
  observed_at: TimestampSchema,
  raw_ref: NonEmptyStringSchema,
  normalized_ref: NonEmptyStringSchema.optional(),
  redaction_status: z.enum(["raw", "redacted", "failed"]),
  summary: JsonObjectSchema
});

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type BodyView = z.infer<typeof BodyViewSchema>;
export type HttpFlowSummary = z.infer<typeof HttpFlowSummarySchema>;
export type LogEventSummary = z.infer<typeof LogEventSummarySchema>;
export type BrowserEventSummary = z.infer<typeof BrowserEventSummarySchema>;
