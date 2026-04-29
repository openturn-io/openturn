import { readdir } from "node:fs/promises";
import { join } from "node:path";

type DemoEntry = {
  cliDir: string;
  slug: string;
};

const examplesDir = join(import.meta.dir, "..", "examples");

const readDemoEntries = async (): Promise<DemoEntry[]> => {
  const purposeDirs = await readdir(examplesDir, { withFileTypes: true });

  const nested = await Promise.all(
    purposeDirs
      .filter((entry) => entry.isDirectory())
      .map(async (purposeEntry) => {
        const purposeDir = join(examplesDir, purposeEntry.name);
        const exampleDirs = await readdir(purposeDir, { withFileTypes: true });

        return Promise.all(
          exampleDirs
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
              const slug = entry.name;
              const cliDir = join(purposeDir, slug, "cli");
              const packageJsonPath = join(cliDir, "package.json");
              const packageJson = Bun.file(packageJsonPath);

              if (!(await packageJson.exists())) {
                return null;
              }

              const manifest = (await packageJson.json()) as { scripts?: { demo?: string } };

              if (!manifest.scripts?.demo) {
                throw new Error(`Missing demo script in ${packageJsonPath}`);
              }

              return { cliDir, slug };
            }),
        );
      }),
  );

  return nested.flat().filter((entry): entry is DemoEntry => entry !== null);
};

const printUsage = (entries: DemoEntry[]) => {
  console.error("Usage: bun run demo <example>");
  console.error("");
  console.error("Available examples:");

  for (const entry of entries) {
    console.error(`  - ${entry.slug}`);
  }
};

const requestedExample = process.argv[2];
const entries = await readDemoEntries();

if (!requestedExample) {
  printUsage(entries);
  process.exit(1);
}

const match = entries.find(
  (entry) => entry.slug === requestedExample,
);

if (!match) {
  console.error(`Unknown example: ${requestedExample}`);
  console.error("");
  printUsage(entries);
  process.exit(1);
}

const proc = Bun.spawn(
  ["bun", "run", "demo"],
  {
    cwd: match.cliDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

const exitCode = await proc.exited;
process.exit(exitCode);
