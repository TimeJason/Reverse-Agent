import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url);

const allowedInternalDeps = new Map([
  ["@software-analysis/core", []],
  ["@software-analysis/services", ["@software-analysis/core"]],
  ["@software-analysis/storage-local", ["@software-analysis/core"]],
  ["@software-analysis/pipeline", ["@software-analysis/core", "@software-analysis/services"]],
  ["@software-analysis/mcp", ["@software-analysis/core", "@software-analysis/services"]],
  [
    "@software-analysis/cli",
    [
      "@software-analysis/core",
      "@software-analysis/services",
      "@software-analysis/storage-local",
      "@software-analysis/pipeline",
      "@software-analysis/mcp"
    ]
  ]
]);

const packageDirs = ["core", "services", "storage-local", "pipeline", "mcp", "cli"];
const errors = [];

for (const dir of packageDirs) {
  const manifestPath = join(root.pathname, "packages", dir, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const packageName = manifest.name;
  const allowed = new Set(allowedInternalDeps.get(packageName) ?? []);
  const deps = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies
  };

  for (const depName of Object.keys(deps)) {
    if (!depName.startsWith("@software-analysis/")) {
      continue;
    }

    if (!allowed.has(depName)) {
      errors.push(`${packageName} must not depend on ${depName}`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log("Package boundary check passed.");
}
