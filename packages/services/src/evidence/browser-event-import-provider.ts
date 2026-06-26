import type {
  ImportFailure,
  ImportProvider,
  ImportProviderInput,
  ImportProviderResult,
  ImportWarning,
  ParsedBrowserEvent
} from "@software-analysis/core";

type BrowserEventType = ParsedBrowserEvent["event_type"];

interface BrowserEventJson {
  timestamp?: unknown;
  observed_at?: unknown;
  type?: unknown;
  event_type?: unknown;
  page_url?: unknown;
  frame_id?: unknown;
  request_id?: unknown;
  related_request_id?: unknown;
  method?: unknown;
  url?: unknown;
  element?: unknown;
}

const browserEventTypes = new Set<BrowserEventType>([
  "navigation",
  "click",
  "input",
  "submit",
  "network"
]);

export class BrowserEventImportProvider implements ImportProvider {
  readonly kind = "browser" as const;

  parse(input: ImportProviderInput): Promise<ImportProviderResult> {
    const text = new TextDecoder().decode(input.content);
    const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
    const evidence: ParsedBrowserEvent[] = [];
    const warnings: ImportWarning[] = [];
    const failures: ImportFailure[] = [];

    for (const [index, line] of lines.entries()) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isObject(parsed)) {
          throw new Error("Browser event line must be a JSON object");
        }
        evidence.push(parseBrowserEvent(parsed, index));
      } catch (error) {
        failures.push({
          code: "BROWSER_EVENT_PARSE_FAILED",
          message: error instanceof Error ? error.message : String(error),
          entry: String(index),
          recoverable: true
        });
      }
    }

    return Promise.resolve({ evidence, warnings, failures });
  }
}

function parseBrowserEvent(input: BrowserEventJson, index: number): ParsedBrowserEvent {
  const eventType = eventTypeValue(input.event_type ?? input.type);
  if (eventType === undefined) {
    throw new Error(`Browser event ${String(index)} has unsupported event_type`);
  }
  const observedAt = timestampValue(input.observed_at ?? input.timestamp);

  return {
    kind: "browser_event",
    observed_at: observedAt,
    raw: input,
    event_type: eventType,
    ...optionalField("page_url", stringValue(input.page_url)),
    ...optionalField("frame_id", stringValue(input.frame_id)),
    ...optionalField("request_id", stringValue(input.request_id)),
    ...optionalField("related_request_id", stringValue(input.related_request_id)),
    ...optionalField("method", stringValue(input.method)),
    ...optionalField("url", stringValue(input.url)),
    ...optionalField("element", elementValue(input.element)),
    warnings: []
  };
}

function eventTypeValue(value: unknown): BrowserEventType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return browserEventTypes.has(value as BrowserEventType) ? (value as BrowserEventType) : undefined;
}

function elementValue(value: unknown): ParsedBrowserEvent["element"] | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  return {
    ...optionalField("text", stringValue(value.text)),
    ...optionalField("accessible_name", stringValue(value.accessible_name)),
    ...optionalField("input_name", stringValue(value.input_name)),
    ...optionalField("label", stringValue(value.label)),
    ...optionalField("placeholder", stringValue(value.placeholder))
  };
}

function timestampValue(value: unknown): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalField<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  const output: Partial<Record<K, V>> = {};
  if (value !== undefined) {
    output[key] = value;
  }
  return output;
}
