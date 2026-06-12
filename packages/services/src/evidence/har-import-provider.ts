import type {
  ImportFailure,
  ImportProvider,
  ImportProviderInput,
  ImportProviderResult,
  ImportWarning,
  ParsedHttpFlow
} from "@software-analysis/core";

interface HarHeader {
  name?: unknown;
  value?: unknown;
}

interface HarEntry {
  startedDateTime?: unknown;
  request?: {
    method?: unknown;
    url?: unknown;
    headers?: HarHeader[];
    postData?: {
      mimeType?: unknown;
      text?: unknown;
      encoding?: unknown;
    };
  };
  response?: {
    status?: unknown;
    headers?: HarHeader[];
    content?: {
      mimeType?: unknown;
      text?: unknown;
      encoding?: unknown;
    };
  };
}

export class HarImportProvider implements ImportProvider {
  readonly kind = "har" as const;

  parse(input: ImportProviderInput): Promise<ImportProviderResult> {
    const warnings: ImportWarning[] = [];
    const failures: ImportFailure[] = [];
    const evidence: ParsedHttpFlow[] = [];
    const text = new TextDecoder().decode(input.content);
    const payload = JSON.parse(text) as { log?: { entries?: HarEntry[] } };
    const entries = payload.log?.entries ?? [];

    for (const [index, entry] of entries.entries()) {
      try {
        evidence.push(parseEntry(entry, index));
      } catch (error) {
        failures.push({
          code: "HAR_ENTRY_PARSE_FAILED",
          message: error instanceof Error ? error.message : String(error),
          entry: String(index),
          recoverable: true
        });
      }
    }

    return Promise.resolve({ evidence, warnings, failures });
  }
}

function parseEntry(entry: HarEntry, index: number): ParsedHttpFlow {
  if (entry.request === undefined) {
    throw new Error("HAR entry missing request");
  }
  const method = stringValue(entry.request.method, "GET");
  const url = stringValue(entry.request.url);
  if (url.length === 0) {
    throw new Error("HAR entry missing request url");
  }

  const request: ParsedHttpFlow["request"] = {
    method,
    url,
    headers: headersToRecord(entry.request.headers)
  };
  const requestBody = bodyToBytes(entry.request.postData?.text, entry.request.postData?.encoding);
  const requestBodyMediaType =
    typeof entry.request.postData?.mimeType === "string"
      ? entry.request.postData.mimeType
      : undefined;
  if (requestBody !== undefined) {
    request.body = requestBody;
  }
  if (requestBodyMediaType !== undefined) {
    request.body_media_type = requestBodyMediaType;
  }

  const response: NonNullable<ParsedHttpFlow["response"]> = {
    headers: headersToRecord(entry.response?.headers)
  };
  const statusCode = numberValue(entry.response?.status);
  const responseBody = bodyToBytes(
    entry.response?.content?.text,
    entry.response?.content?.encoding
  );
  const responseBodyMediaType =
    typeof entry.response?.content?.mimeType === "string"
      ? entry.response.content.mimeType
      : undefined;
  if (statusCode !== undefined) {
    response.status_code = statusCode;
  }
  if (responseBody !== undefined) {
    response.body = responseBody;
  }
  if (responseBodyMediaType !== undefined) {
    response.body_media_type = responseBodyMediaType;
  }

  return {
    kind: "http_flow",
    observed_at: timestampValue(entry.startedDateTime),
    raw: entry,
    request,
    response,
    warnings:
      entry.response === undefined
        ? [
            {
              code: "HAR_RESPONSE_MISSING",
              message: `HAR entry ${String(index)} has no response`,
              entry: String(index),
              recoverable: true
            }
          ]
        : []
  };
}

function headersToRecord(headers: HarHeader[] | undefined): Record<string, string> {
  return Object.fromEntries(
    (headers ?? [])
      .filter((header) => typeof header.name === "string")
      .map((header) => [String(header.name), headerValue(header.value)])
  );
}

function headerValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function bodyToBytes(value: unknown, encoding: unknown): Uint8Array | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (encoding === "base64") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  return new TextEncoder().encode(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function timestampValue(value: unknown): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}
