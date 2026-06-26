import type {
  ArtifactStore,
  AuditSink,
  CaptureSessionStore,
  EvidenceStore,
  FactStore,
  PipelineRunStore
} from "@software-analysis/core";
import { createId } from "@software-analysis/core";

export interface DiagnosticsServiceDependencies {
  audit: AuditSink;
  artifacts: ArtifactStore;
  captureSessions: CaptureSessionStore;
  evidence: EvidenceStore;
  facts: FactStore;
  pipelineRuns: PipelineRunStore;
}

export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  severity: "info" | "warning" | "error";
  message: string;
  recommendation?: string;
}

export interface DiagnosticReport {
  schema_version: 1;
  generated_at: string;
  project_id: string;
  telemetry: "disabled";
  checks: DiagnosticCheck[];
  metrics: {
    capture_sessions: number;
    evidence: number;
    facts: number;
    pipeline_runs: number;
    artifacts: number;
    failed_pipeline_runs: number;
  };
}

export class DiagnosticsService {
  constructor(private readonly deps: DiagnosticsServiceDependencies) {}

  async run(projectId: string): Promise<DiagnosticReport> {
    const [sessions, evidence, facts, runs, artifacts] = await Promise.all([
      this.deps.captureSessions.listByProject(projectId),
      this.deps.evidence.listByProject(projectId),
      this.deps.facts.listByProject(projectId),
      this.deps.pipelineRuns.listByProject(projectId),
      this.deps.artifacts.listByProject(projectId)
    ]);
    const failedRuns = runs.filter((run) => run.status === "failed");
    const checks: DiagnosticCheck[] = [
      {
        name: "node_runtime",
        ok: true,
        severity: "info",
        message: `Node runtime available: ${process.version}`
      },
      {
        name: "telemetry",
        ok: true,
        severity: "info",
        message: "Remote telemetry is disabled."
      },
      {
        name: "evidence_metadata",
        ok: evidence.every((item) => item.id.startsWith("ev_") && item.redaction_status !== "raw"),
        severity: "error",
        message: "Evidence metadata is present and redacted by default.",
        recommendation: "Re-import evidence with the default redaction policy if this check fails."
      },
      createCheck({
        name: "pipeline_runs",
        ok: failedRuns.length === 0,
        severity: failedRuns.length === 0 ? "info" : "warning",
        message:
          failedRuns.length === 0
            ? "No failed pipeline runs."
            : `${String(failedRuns.length)} failed pipeline run(s) detected.`,
        recommendation:
          failedRuns.length === 0 ? undefined : "Inspect pipeline_run.error_code and rerun."
      })
    ];
    const report: DiagnosticReport = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      project_id: projectId,
      telemetry: "disabled",
      checks,
      metrics: {
        capture_sessions: sessions.length,
        evidence: evidence.length,
        facts: facts.length,
        pipeline_runs: runs.length,
        artifacts: artifacts.length,
        failed_pipeline_runs: failedRuns.length
      }
    };
    await this.deps.audit.append({
      id: createId("audit"),
      project_id: projectId,
      actor: "service",
      action: "diagnostics.run",
      target_type: "diagnostics",
      target_id: "local",
      metadata: {
        check_count: checks.length,
        error_count: checks.filter((check) => !check.ok && check.severity === "error").length,
        telemetry: report.telemetry
      },
      created_at: new Date().toISOString()
    });
    return report;
  }
}

function createCheck(
  input: Omit<DiagnosticCheck, "recommendation"> & { recommendation?: string | undefined }
): DiagnosticCheck {
  const { recommendation, ...check } = input;
  return recommendation === undefined ? check : { ...check, recommendation };
}
