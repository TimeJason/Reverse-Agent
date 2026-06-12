import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";

import { createWorkspaceLayout } from "../workspace/workspace-layout.js";

export type SqliteClient = Database.Database;

export function createSqliteClient(projectRoot: string): SqliteClient {
  const layout = createWorkspaceLayout(projectRoot);
  mkdirSync(layout.dbDir, { recursive: true });
  const db = new Database(join(layout.dbDir, "project.sqlite"));
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  return db;
}

export function listSqliteTables(client: SqliteClient): string[] {
  const rows = client
    .prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name"
    )
    .all();

  return rows.map((row) => {
    if (!isNameRow(row)) {
      throw new Error("Unexpected sqlite_master row");
    }
    return row.name;
  });
}

function isNameRow(row: unknown): row is { name: string } {
  return typeof row === "object" && row !== null && "name" in row && typeof row.name === "string";
}
