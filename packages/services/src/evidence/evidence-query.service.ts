import type {
  CursorPage,
  Evidence,
  EvidenceStore,
  HttpFlowSummary,
  LogEventSummary,
  LogSearchQuery,
  TrafficSearchQuery
} from "@software-analysis/core";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class EvidenceQueryService {
  constructor(private readonly evidence: EvidenceStore) {}

  async searchTraffic(query: TrafficSearchQuery): Promise<CursorPage<Evidence>> {
    const rows = await this.evidence.listByProject(query.project_id);
    return paginate(
      rows
        .filter((evidence) => evidence.kind === "http_exchange")
        .filter((evidence) => {
          const summary = evidence.summary as HttpFlowSummary;
          return (
            matchesTime(evidence, query.observed_from, query.observed_to) &&
            matches(query.host, summary.host) &&
            matches(query.method?.toUpperCase(), summary.method.toUpperCase()) &&
            contains(query.path_contains, summary.path) &&
            matchesStatus(query, summary.status_code) &&
            matches(query.content_type, summary.content_type) &&
            matches(query.capture_session_id, evidence.capture_session_id)
          );
        }),
      query.cursor,
      query.limit
    );
  }

  async getRequest(projectId: string, evidenceId: string): Promise<Evidence | null> {
    const evidence = await this.evidence.get(evidenceId);
    if (evidence?.project_id !== projectId || evidence.kind !== "http_exchange") {
      return null;
    }
    return evidence;
  }

  async listHosts(projectId: string): Promise<string[]> {
    const rows = await this.evidence.listByProject(projectId);
    return [
      ...new Set(
        rows
          .filter((evidence) => evidence.kind === "http_exchange")
          .map((evidence) => (evidence.summary as HttpFlowSummary).host)
      )
    ].sort();
  }

  async searchLogs(query: LogSearchQuery): Promise<CursorPage<Evidence>> {
    const rows = await this.evidence.listByProject(query.project_id);
    return paginate(
      rows
        .filter((evidence) => evidence.kind === "log_event")
        .filter((evidence) => {
          const summary = evidence.summary as LogEventSummary;
          return (
            matchesTime(evidence, query.observed_from, query.observed_to) &&
            matches(query.level, summary.level) &&
            matches(query.service, summary.service) &&
            matches(query.trace_id, summary.trace_id) &&
            matches(query.request_id, summary.request_id) &&
            contains(query.message_contains, summary.message)
          );
        }),
      query.cursor,
      query.limit
    );
  }
}

function paginate<T extends { id: string }>(
  items: T[],
  cursor?: string,
  limit?: number
): CursorPage<T> {
  const boundedLimit = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const startIndex =
    cursor === undefined ? 0 : Math.max(items.findIndex((item) => item.id === cursor) + 1, 0);
  const pageItems = items.slice(startIndex, startIndex + boundedLimit);
  const next = items[startIndex + boundedLimit];
  if (next === undefined) {
    return { items: pageItems };
  }
  return { items: pageItems, next_cursor: next.id };
}

function matches(expected: string | undefined, actual: string | undefined): boolean {
  return expected === undefined || actual === expected;
}

function contains(expected: string | undefined, actual: string | undefined): boolean {
  return expected === undefined || (actual ?? "").includes(expected);
}

function matchesTime(evidence: Evidence, from?: string, to?: string): boolean {
  return (
    (from === undefined || evidence.observed_at >= from) &&
    (to === undefined || evidence.observed_at <= to)
  );
}

function matchesStatus(query: TrafficSearchQuery, status: number | undefined): boolean {
  if (query.status_code !== undefined) {
    return status === query.status_code;
  }
  return (
    (query.status_min === undefined || (status !== undefined && status >= query.status_min)) &&
    (query.status_max === undefined || (status !== undefined && status <= query.status_max))
  );
}
