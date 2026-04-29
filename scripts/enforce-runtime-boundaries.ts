import { access, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

type Runtime = "browser" | "bun" | "worker";

type PackageManifest = {
  name?: string;
  openturn?: {
    runtime?: Runtime;
  };
};

const forbiddenImportPatterns = [
  /\bfrom\s+["']node:[^"']+["']/g,
  /\bimport\s+["']node:[^"']+["']/g,
  /\bfrom\s+["'](?:assert|buffer|child_process|cluster|crypto|dgram|diagnostics_channel|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|readline|stream|string_decoder|sys|timers|tls|tty|url|util|v8|vm|worker_threads|zlib)["']/g,
  /\bimport\s+["'](?:assert|buffer|child_process|cluster|crypto|dgram|diagnostics_channel|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|readline|stream|string_decoder|sys|timers|tls|tty|url|util|v8|vm|worker_threads|zlib)["']/g,
] as const;

const forbiddenWorkerGlobalPatterns = [
  /\bBun\b/g,
  /\bBuffer\b/g,
  /\bprocess\b/g,
] as const;

const forbiddenDeterminismPatterns = [
  /\bMath\.random\s*\(/g,
  /\bDate\.now\s*\(/g,
  /\bnew\s+Date\s*\(/g,
  /\bfetch\s*\(/g,
  /\bsetTimeout\s*\(/g,
  /\bsetInterval\s*\(/g,
  /\bqueueMicrotask\s*\(/g,
  /\bconsole\.[A-Za-z_$][\w$]*\s*\(/g,
] as const;

async function main(): Promise<void> {
  const packageJsonPaths = await findPackageJsonPaths(process.cwd());
  const failures: string[] = [];

  for (const packageJsonPath of packageJsonPaths) {
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageManifest;
    const runtime = manifest.openturn?.runtime;

    if (runtime === undefined) {
      continue;
    }

    const packageDir = packageJsonPath.slice(0, -"/package.json".length);
    const sourceFiles = await findTypeScriptFiles(join(packageDir, "src"));
    const tsconfigPath = join(packageDir, "tsconfig.json");
    const tsconfigContent = await readFile(tsconfigPath, "utf8");

    if (runtime === "worker") {
      if (!tsconfigContent.includes("tsconfig.worker.json")) {
        failures.push(`${relative(process.cwd(), tsconfigPath)} must extend tsconfig.worker.json.`);
      }
    } else if (runtime === "browser") {
      if (!tsconfigContent.includes("tsconfig.browser.json")) {
        failures.push(`${relative(process.cwd(), tsconfigPath)} must extend tsconfig.browser.json.`);
      }
    } else if (runtime === "bun") {
      if (!tsconfigContent.includes("tsconfig.bun.json")) {
        failures.push(`${relative(process.cwd(), tsconfigPath)} must extend tsconfig.bun.json.`);
      }
    }

    if (runtime !== "worker") {
      continue;
    }

    for (const sourceFile of sourceFiles) {
      const content = await readFile(sourceFile, "utf8");

      for (const pattern of forbiddenImportPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(content)) {
          failures.push(`${relative(process.cwd(), sourceFile)} imports a Node-only module but is declared runtime=worker.`);
          break;
        }
      }

      for (const pattern of forbiddenWorkerGlobalPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(content)) {
          failures.push(`${relative(process.cwd(), sourceFile)} uses a Bun/Node global but is declared runtime=worker.`);
          break;
        }
      }

      if (shouldEnforceDeterminism(packageDir)) {
        for (const pattern of forbiddenDeterminismPatterns) {
          pattern.lastIndex = 0;
          if (pattern.test(content)) {
            failures.push(`${relative(process.cwd(), sourceFile)} uses a non-deterministic or side-effectful ambient API in authored worker-runtime code.`);
            break;
          }
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error("Runtime boundary check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Runtime boundary check passed.");
}

async function findPackageJsonPaths(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  const directories = ["packages", "examples"];

  for (const directory of directories) {
    const absoluteDirectory = join(rootDir, directory);
    const firstLevel = await readdir(absoluteDirectory, { withFileTypes: true });

    for (const entry of firstLevel) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (directory === "packages") {
        const packageJsonPath = join(absoluteDirectory, entry.name, "package.json");
        if (await fileExists(packageJsonPath)) {
          results.push(packageJsonPath);
        }
        continue;
      }

      const secondLevel = await readdir(join(absoluteDirectory, entry.name), { withFileTypes: true });
      for (const nestedEntry of secondLevel) {
        if (!nestedEntry.isDirectory()) {
          continue;
        }
        const thirdLevel = await readdir(join(absoluteDirectory, entry.name, nestedEntry.name), { withFileTypes: true });
        for (const leafEntry of thirdLevel) {
          if (leafEntry.isDirectory()) {
            const packageJsonPath = join(absoluteDirectory, entry.name, nestedEntry.name, leafEntry.name, "package.json");
            if (await fileExists(packageJsonPath)) {
              results.push(packageJsonPath);
            }
          }
        }
      }
    }
  }

  return results;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findTypeScriptFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return findTypeScriptFiles(absolutePath);
      }

      if (entry.isFile()
        && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
        && !entry.name.endsWith(".test.ts")
        && !entry.name.endsWith(".test.tsx")) {
        return [absolutePath];
      }

      return [];
    }));

    return files.flat();
  } catch {
    return [];
  }
}

function shouldEnforceDeterminism(packageDir: string): boolean {
  const normalized = packageDir.replaceAll("\\", "/");

  return normalized.endsWith("/packages/core")
    || normalized.endsWith("/packages/gamekit")
    || /\/examples\/[^/]+\/[^/]+\/game$/.test(normalized);
}

void main();
