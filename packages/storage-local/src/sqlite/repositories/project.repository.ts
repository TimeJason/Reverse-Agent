import { ProjectSchema } from "@software-analysis/core";
import type { Project, ProjectStore } from "@software-analysis/core";

import type { SqliteClient } from "../sqlite-client.js";

export class SqliteProjectRepository implements ProjectStore {
  constructor(private readonly client: SqliteClient) {}

  save(project: Project): Promise<Project> {
    this.client
      .prepare(
        `insert into projects (id, workspace_id, payload_json)
         values (@id, @workspace_id, @payload_json)
         on conflict(id) do update set
           workspace_id = excluded.workspace_id,
           payload_json = excluded.payload_json`
      )
      .run({
        id: project.id,
        workspace_id: project.workspace_id,
        payload_json: JSON.stringify(project)
      });
    return Promise.resolve(project);
  }

  get(projectId: string): Promise<Project | null> {
    const row = this.client
      .prepare("select payload_json from projects where id = ?")
      .get(projectId);
    if (row === undefined) {
      return Promise.resolve(null);
    }

    if (!isProjectPayloadRow(row)) {
      throw new Error("Unexpected project row shape");
    }

    return Promise.resolve(ProjectSchema.parse(JSON.parse(row.payload_json)));
  }
}

function isProjectPayloadRow(row: unknown): row is { payload_json: string } {
  return (
    typeof row === "object" &&
    row !== null &&
    "payload_json" in row &&
    typeof row.payload_json === "string"
  );
}
