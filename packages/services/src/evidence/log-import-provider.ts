import type {
  ImportProvider,
  ImportProviderInput,
  ImportProviderResult,
  ImportWarning,
  ParsedLogEvent
} from "@software-analysis/core";

export interface LogImportOptions {
  format?: "jsonl" | "nginx" | "generic";
  service?: string;
  timestampField?: string;
  levelField?: string;
  messageField?: string;
  traceIdField?: string;
  requestIdField?: string;
  correlationIdField?: string;
}

export class LogImportProvider implements ImportProvider {
  readonly kind = "log" as const;

  parse(input: ImportProviderInput): Promise<ImportProviderResult> {
    const options = (input.options ?? {}) as LogImportOptions;
    const text = new TextDecoder().decode(input.content);
    const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
    const evidence: ParsedLogEvent[] = [];
    const warnings: ImportWarning[] = [];

    for (const [index, line] of lines.entries()) {
      const parsed =
        options.format === "nginx"
          ? parseNginxLine(line, index, options)
          : options.format === "generic"
            ? parseGenericLine(line, index, options)
            : parseJsonLine(line, index, options);
      evidence.push(parsed.event);
      warnings.push(...parsed.warnings);
    }

    return Promise.resolve({ evidence, warnings, failures: [] });
  }
}

function parseJsonLine(
  line: string,
  index: number,
  options: LogImportOptions
): { event: ParsedLogEvent; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isJsonObject(parsed)) {
      warnings.push({
        code: "JSONL_NON_OBJECT_FALLBACK",
        message: `Line ${String(index)} JSON value is not an object; imported as generic log line`,
        entry: String(index),
        recoverable: true
      });
      return parseGenericLine(line, index, options, warnings);
    }
    const fields = parsed;
    const timestamp =
      stringField(fields, options.timestampField ?? "timestamp") ?? new Date(0).toISOString();
    const message = stringField(fields, options.messageField ?? "message") ?? line;
    const event = createLogEvent({
      kind: "log_event",
      observed_at: normalizeTimestamp(timestamp),
      raw: line,
      timestamp: normalizeTimestamp(timestamp),
      level: stringField(fields, options.levelField ?? "level"),
      service: stringField(fields, "service") ?? options.service,
      message,
      trace_id: stringField(fields, options.traceIdField ?? "trace_id"),
      request_id: stringField(fields, options.requestIdField ?? "request_id"),
      correlation_id: stringField(fields, options.correlationIdField ?? "correlation_id"),
      fields,
      warnings
    });
    return {
      event,
      warnings
    };
  } catch {
    warnings.push({
      code: "JSONL_PARSE_FAILED_FALLBACK",
      message: `Line ${String(index)} is not valid JSON; imported as generic log line`,
      entry: String(index),
      recoverable: true
    });
    return parseGenericLine(line, index, options, warnings);
  }
}

function parseNginxLine(
  line: string,
  index: number,
  options: LogImportOptions
): { event: ParsedLogEvent; warnings: ImportWarning[] } {
  const match =
    /^(?<ip>\S+) \S+ \S+ \[(?<time>[^\]]+)] "(?<method>\S+) (?<path>\S+) (?<protocol>[^"]+)" (?<status>\d{3}) (?<bytes>\S+)/.exec(
      line
    );
  if (match?.groups === undefined) {
    return parseGenericLine(line, index, options, [
      {
        code: "NGINX_PARSE_FAILED_FALLBACK",
        message: `Line ${String(index)} does not match nginx access log format`,
        entry: String(index),
        recoverable: true
      }
    ]);
  }

  const timestamp = normalizeNginxTimestamp(match.groups.time ?? "");
  const method = match.groups.method ?? "";
  const path = match.groups.path ?? "";
  const status = Number(match.groups.status);
  const fields = {
    client_ip: match.groups.ip,
    method,
    path,
    protocol: match.groups.protocol,
    status,
    bytes: match.groups.bytes
  };
  return {
    event: createLogEvent({
      kind: "log_event",
      observed_at: timestamp,
      raw: line,
      timestamp,
      service: options.service,
      message: `${method} ${path} ${String(status)}`,
      fields,
      warnings: []
    }),
    warnings: []
  };
}

function parseGenericLine(
  line: string,
  index: number,
  options: LogImportOptions,
  existingWarnings: ImportWarning[] = []
): { event: ParsedLogEvent; warnings: ImportWarning[] } {
  const timestamp = new Date(0).toISOString();
  return {
    event: createLogEvent({
      kind: "log_event",
      observed_at: timestamp,
      raw: line,
      timestamp,
      service: options.service,
      message: line,
      fields: { line_number: index },
      warnings: existingWarnings
    }),
    warnings: existingWarnings
  };
}

function stringField(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" ? value : undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function normalizeNginxTimestamp(value: string): string {
  const match =
    /^(?<day>\d{2})\/(?<month>[A-Za-z]{3})\/(?<year>\d{4}):(?<time>\d{2}:\d{2}:\d{2}) (?<offset>[+-]\d{4})$/.exec(
      value
    );
  if (match?.groups === undefined) {
    return new Date(0).toISOString();
  }
  const day = match.groups.day ?? "01";
  const month = match.groups.month ?? "Jan";
  const year = match.groups.year ?? "1970";
  const time = match.groups.time ?? "00:00:00";
  const offset = match.groups.offset ?? "+0000";
  const normalized = `${day} ${month} ${year} ${time} GMT${offset}`;
  return normalizeTimestamp(normalized);
}

function createLogEvent(input: {
  kind: "log_event";
  observed_at: string;
  raw: string;
  timestamp: string;
  level?: string | undefined;
  service?: string | undefined;
  message: string;
  trace_id?: string | undefined;
  request_id?: string | undefined;
  correlation_id?: string | undefined;
  fields: Record<string, unknown>;
  warnings: ImportWarning[];
}): ParsedLogEvent {
  const event: ParsedLogEvent = {
    kind: input.kind,
    observed_at: input.observed_at,
    raw: input.raw,
    timestamp: input.timestamp,
    message: input.message,
    fields: input.fields,
    warnings: input.warnings
  };
  if (input.level !== undefined) {
    event.level = input.level;
  }
  if (input.service !== undefined) {
    event.service = input.service;
  }
  if (input.trace_id !== undefined) {
    event.trace_id = input.trace_id;
  }
  if (input.request_id !== undefined) {
    event.request_id = input.request_id;
  }
  if (input.correlation_id !== undefined) {
    event.correlation_id = input.correlation_id;
  }
  return event;
}
