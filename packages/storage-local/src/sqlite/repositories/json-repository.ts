import type { z } from "zod";

import type { SqliteClient } from "../sqlite-client.js";

interface PayloadRow {
  payload_json: string;
}

type IndexedValues<T> = (entity: T) => Record<string, string | number>;

export class JsonProjectScopedRepository<T extends { id: string; project_id: string }> {
  constructor(
    protected readonly client: SqliteClient,
    protected readonly table: string,
    protected readonly schema: z.ZodType<T>,
    protected readonly indexedValues: IndexedValues<T> = () => ({})
  ) {}

  save(entity: T): Promise<T> {
    const values = {
      id: entity.id,
      project_id: entity.project_id,
      ...this.indexedValues(entity),
      payload_json: JSON.stringify(entity)
    };
    const columns = Object.keys(values);
    const placeholders = columns.map((column) => `@${column}`);
    const updates = columns
      .filter((column) => column !== "id")
      .map((column) => `${column} = excluded.${column}`);

    this.client
      .prepare(
        `insert into ${this.table} (${columns.join(", ")})
         values (${placeholders.join(", ")})
         on conflict(id) do update set ${updates.join(", ")}`
      )
      .run(values);
    return Promise.resolve(entity);
  }

  get(id: string): Promise<T | null> {
    const row = this.client.prepare(`select payload_json from ${this.table} where id = ?`).get(id);
    return Promise.resolve(this.parseRow(row));
  }

  listByProject(projectId: string): Promise<T[]> {
    const rows = this.client
      .prepare(`select payload_json from ${this.table} where project_id = ? order by id`)
      .all(projectId);

    return Promise.resolve(rows.map((row) => this.parseRequiredRow(row)));
  }

  protected parseRow(row: unknown): T | null {
    if (row === undefined) {
      return null;
    }
    return this.parseRequiredRow(row);
  }

  protected parseRequiredRow(row: unknown): T {
    if (!isPayloadRow(row)) {
      throw new Error(`Unexpected row shape for ${this.table}`);
    }
    return this.schema.parse(JSON.parse(row.payload_json));
  }
}

export class JsonIdRepository<T extends { id: string }> {
  constructor(
    protected readonly client: SqliteClient,
    protected readonly table: string,
    protected readonly schema: z.ZodType<T>
  ) {}

  save(entity: T): Promise<T> {
    this.client
      .prepare(
        `insert into ${this.table} (id, payload_json)
         values (@id, @payload_json)
         on conflict(id) do update set payload_json = excluded.payload_json`
      )
      .run({
        id: entity.id,
        payload_json: JSON.stringify(entity)
      });
    return Promise.resolve(entity);
  }

  get(id: string): Promise<T | null> {
    const row = this.client.prepare(`select payload_json from ${this.table} where id = ?`).get(id);
    if (row === undefined) {
      return Promise.resolve(null);
    }

    if (!isPayloadRow(row)) {
      throw new Error(`Unexpected row shape for ${this.table}`);
    }

    return Promise.resolve(this.schema.parse(JSON.parse(row.payload_json)));
  }
}

function isPayloadRow(row: unknown): row is PayloadRow {
  return (
    typeof row === "object" &&
    row !== null &&
    "payload_json" in row &&
    typeof row.payload_json === "string"
  );
}
