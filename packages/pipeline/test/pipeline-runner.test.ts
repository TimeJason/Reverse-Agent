import { describe, expect, test } from "vitest";

import type { AuditEvent, AuditSink, PipelineRun, PipelineRunStore } from "@software-analysis/core";

import { PipelineRunner } from "../src/index.js";

class MemoryPipelineRunStore implements PipelineRunStore {
  readonly runs = new Map<string, PipelineRun>();
  readonly history: PipelineRun[] = [];

  save(run: PipelineRun): Promise<PipelineRun> {
    this.runs.set(run.id, run);
    this.history.push(run);
    return Promise.resolve(run);
  }

  get(runId: string): Promise<PipelineRun | null> {
    return Promise.resolve(this.runs.get(runId) ?? null);
  }

  listByProject(projectId: string): Promise<PipelineRun[]> {
    return Promise.resolve([...this.runs.values()].filter((run) => run.project_id === projectId));
  }
}

class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

describe("pipeline runner", () => {
  test("persists successful pipeline lifecycle and outputs", async () => {
    const runs = new MemoryPipelineRunStore();
    const audit = new MemoryAuditSink();
    const runner = new PipelineRunner({ audit, runs });

    const result = await runner.run({
      inputRefs: ["ev_demo"],
      name: "empty",
      projectId: "proj_demo",
      steps: [
        {
          name: "noop",
          run: () =>
            Promise.resolve({
              metrics: { steps: 1 },
              outputIds: ["fact_demo"],
              warnings: ["nothing to do"]
            })
        }
      ],
      version: "0.1.0"
    });

    expect(result.status).toBe("succeeded");
    expect(result.output_ids).toEqual(["fact_demo"]);
    expect(result.warnings).toEqual(["nothing to do"]);
    expect(runs.history.map((run) => run.status)).toEqual(["queued", "running", "succeeded"]);
    expect(audit.events.map((event) => event.action)).toEqual([
      "pipeline.queued",
      "pipeline.running",
      "pipeline.succeeded"
    ]);
  });

  test("persists failed pipeline lifecycle with error code", async () => {
    const runs = new MemoryPipelineRunStore();
    const runner = new PipelineRunner({ audit: new MemoryAuditSink(), runs });

    const result = await runner.run({
      inputRefs: ["ev_demo"],
      name: "broken",
      projectId: "proj_demo",
      steps: [
        {
          name: "fail",
          run: () => Promise.reject(new Error("boom"))
        }
      ],
      version: "0.1.0"
    });

    expect(result.status).toBe("failed");
    expect(result.error_code).toBe("PIPELINE_STEP_FAILED");
    expect(runs.history.map((run) => run.status)).toEqual(["queued", "running", "failed"]);
  });
});
