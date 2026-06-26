import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const project = await mkdtemp(join(tmpdir(), "sa-plugins-"));
const manifests = [
  "examples/plugins/log-import-provider/manifest.json",
  "examples/plugins/markdown-exporter/manifest.json"
];

try {
  await run("node", ["packages/cli/dist/index.js", "init", project, "--json"]);
  for (const manifestPath of manifests) {
    const absoluteManifest = resolve(root, manifestPath);
    const validation = JSON.parse(
      await run("node", [
        "packages/cli/dist/index.js",
        "plugins",
        "validate",
        absoluteManifest,
        "--project",
        project,
        "--json"
      ])
    );
    assert(validation.ok === true, `${manifestPath} failed plugin validation`);

    const manifest = JSON.parse(await readFile(absoluteManifest, "utf8"));
    const entrypoint = resolve(dirname(absoluteManifest), manifest.entrypoint);
    const module = await import(pathToFileURL(entrypoint).href);
    assert(module.plugin?.name === manifest.name, `${manifestPath} entrypoint name mismatch`);
    assert(
      Array.isArray(module.plugin?.capabilities),
      `${manifestPath} entrypoint missing capabilities`
    );
  }

  const logPluginModule = await import(
    pathToFileURL(resolve(root, "examples/plugins/log-import-provider/index.js")).href
  );
  const parsed = logPluginModule.plugin.parse("info booted\nwarn slow");
  assert(parsed.length === 2, "log provider example did not parse two lines");
  assert(JSON.stringify(parsed).includes("redacted"), "log provider example must stay redacted");

  const exporterModule = await import(
    pathToFileURL(resolve(root, "examples/plugins/markdown-exporter/index.js")).href
  );
  const exported = exporterModule.plugin.export({ title: "Demo", items: ["one"] });
  assert(exported.includes("# Demo"), "markdown exporter example did not export markdown");
} finally {
  await rm(project, { recursive: true, force: true });
}

async function run(command, args) {
  const { stdout } = await exec(command, args, { cwd: root });
  return stdout;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
