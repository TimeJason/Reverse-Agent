import { pathToFileURL } from "node:url";

import { Command } from "commander";

import {
  createSqliteClient,
  initWorkspace,
  listSqliteTables,
  readProjectConfig,
  runMigrations
} from "@software-analysis/storage-local";

export interface CliIo {
  stdout(text: string): void;
}

export function createCli(io: CliIo = defaultIo()): Command {
  const program = new Command();
  program.name("software-analysis").description("Software Analysis MCP local CLI");

  program
    .command("init")
    .argument("<path>")
    .option("--json", "print JSON output")
    .action(async (path: string, options: { json?: boolean }) => {
      const result = await initWorkspace(path, {
        name: "Demo Analysis",
        workspaceName: "Local Workspace"
      });
      const client = createSqliteClient(path);
      try {
        runMigrations(client);
      } finally {
        client.close();
      }

      writeOutput(io, options.json, {
        ok: true,
        project: result.config,
        projectRoot: result.projectRoot
      });
    });

  const project = program.command("project");
  project
    .command("status")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; json?: boolean }) => {
      const config = await readProjectConfig(options.project);
      const client = createSqliteClient(options.project);
      try {
        writeOutput(io, options.json, {
          ok: true,
          project: config,
          storage: {
            tables: listSqliteTables(client)
          }
        });
      } finally {
        client.close();
      }
    });

  program
    .command("doctor")
    .option("--json", "print JSON output")
    .action((options: { json?: boolean }) => {
      writeOutput(io, options.json, {
        ok: true,
        checks: {
          node: {
            ok: true,
            version: process.version
          }
        }
      });
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  await createCli().parseAsync(argv);
}

function writeOutput(io: CliIo, json: boolean | undefined, value: unknown): void {
  io.stdout(json === true ? JSON.stringify(value) : String(value));
}

function defaultIo(): CliIo {
  return {
    stdout(text: string): void {
      process.stdout.write(`${text}\n`);
    }
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
