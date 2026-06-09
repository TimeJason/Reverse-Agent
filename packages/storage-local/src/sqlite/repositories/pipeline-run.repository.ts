import { PipelineRunSchema } from "@software-analysis/core";
import type { PipelineRun, PipelineRunStore } from "@software-analysis/core";

import type { SqliteClient } from "../sqlite-client.js";
import { JsonProjectScopedRepository } from "./json-repository.js";

export class SqlitePipelineRunRepository
  extends JsonProjectScopedRepository<PipelineRun>
  implements PipelineRunStore
{
  constructor(client: SqliteClient) {
    super(client, "pipeline_runs", PipelineRunSchema, (run) => ({ status: run.status }));
  }
}
