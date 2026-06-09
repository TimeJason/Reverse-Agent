import type { AuditSink, PipelineRun, PipelineRunStore } from "@software-analysis/core";
import { PipelineRunSchema, createId } from "@software-analysis/core";

export interface PipelineStepResult {
  outputIds?: string[];
  warnings?: string[];
  metrics?: Record<string, unknown>;
}

export interface PipelineStep {
  name: string;
  run(): Promise<PipelineStepResult>;
}

export interface RunPipelineInput {
  projectId: string;
  name: string;
  version: string;
  inputRefs: string[];
  steps: PipelineStep[];
}

export interface PipelineRunnerDependencies {
  runs: PipelineRunStore;
  audit: AuditSink;
}

export class PipelineRunner {
  constructor(private readonly deps: PipelineRunnerDependencies) {}

  async run(input: RunPipelineInput): Promise<PipelineRun> {
    const createdAt = new Date().toISOString();
    const runId = createId("run");
    let run = PipelineRunSchema.parse({
      id: runId,
      project_id: input.projectId,
      name: input.name,
      version: input.version,
      status: "queued",
      input_refs: input.inputRefs,
      output_ids: [],
      warnings: [],
      metrics: {},
      created_at: createdAt,
      updated_at: createdAt
    });

    run = await this.saveAndAudit(run, "pipeline.queued");
    run = await this.saveAndAudit(
      {
        ...run,
        status: "running",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      "pipeline.running"
    );

    try {
      for (const step of input.steps) {
        const result = await step.run();
        run = {
          ...run,
          metrics: { ...run.metrics, ...result.metrics },
          output_ids: [...run.output_ids, ...(result.outputIds ?? [])],
          warnings: [...run.warnings, ...(result.warnings ?? [])],
          updated_at: new Date().toISOString()
        };
      }

      return await this.saveAndAudit(
        {
          ...run,
          status: "succeeded",
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        "pipeline.succeeded"
      );
    } catch {
      return this.saveAndAudit(
        {
          ...run,
          error_code: "PIPELINE_STEP_FAILED",
          status: "failed",
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        "pipeline.failed"
      );
    }
  }

  private async saveAndAudit(run: PipelineRun, action: string): Promise<PipelineRun> {
    const saved = await this.deps.runs.save(PipelineRunSchema.parse(run));
    await this.deps.audit.append({
      id: createId("audit"),
      project_id: saved.project_id,
      actor: "pipeline",
      action,
      target_type: "pipeline_run",
      target_id: saved.id,
      metadata: { status: saved.status },
      created_at: new Date().toISOString()
    });
    return saved;
  }
}
