import type { SqliteClient } from "../sqlite-client.js";

export interface SqliteMigration {
  id: string;
  statements: string[];
}

export interface MigrationResult {
  applied: string[];
}

export const initialMigrations: SqliteMigration[] = [
  {
    id: "0001_initial",
    statements: [
      `create table workspaces (
        id text primary key,
        payload_json text not null
      )`,
      `create table projects (
        id text primary key,
        workspace_id text not null,
        payload_json text not null
      )`,
      `create table capture_sessions (
        id text primary key,
        project_id text not null,
        payload_json text not null
      )`,
      `create table evidence_sources (
        id text primary key,
        project_id text not null,
        payload_json text not null
      )`,
      `create table evidence_index (
        id text primary key,
        project_id text not null,
        kind text not null,
        observed_at text not null,
        payload_json text not null
      )`,
      `create table facts (
        id text primary key,
        project_id text not null,
        kind text not null,
        payload_json text not null
      )`,
      `create table findings (
        id text primary key,
        project_id text not null,
        kind text not null,
        confidence real not null,
        payload_json text not null
      )`,
      `create table pipeline_runs (
        id text primary key,
        project_id text not null,
        status text not null,
        payload_json text not null
      )`,
      `create table artifacts (
        id text primary key,
        project_id text not null,
        kind text not null,
        payload_json text not null
      )`,
      `create table redaction_policies (
        id text primary key,
        project_id text not null,
        version integer not null,
        payload_json text not null
      )`,
      `create table audit_events (
        id text primary key,
        project_id text not null,
        action text not null,
        created_at text not null,
        payload_json text not null
      )`
    ]
  }
];

export function runMigrations(
  client: SqliteClient,
  migrations: SqliteMigration[] = initialMigrations
): MigrationResult {
  ensureMigrationTable(client);
  const applied: string[] = [];

  for (const migration of migrations) {
    if (isMigrationApplied(client, migration.id)) {
      continue;
    }

    const apply = client.transaction(() => {
      for (const statement of migration.statements) {
        client.prepare(statement).run();
      }
      client
        .prepare("insert into schema_migrations (id, applied_at) values (?, ?)")
        .run(migration.id, new Date().toISOString());
    });

    try {
      apply();
      applied.push(migration.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${migration.id} failed: ${message}`, { cause: error });
    }
  }

  return { applied };
}

function ensureMigrationTable(client: SqliteClient): void {
  client
    .prepare(
      `create table if not exists schema_migrations (
        id text primary key,
        applied_at text not null
      )`
    )
    .run();
}

function isMigrationApplied(client: SqliteClient, id: string): boolean {
  const row = client.prepare("select id from schema_migrations where id = ?").get(id);
  return row !== undefined;
}
