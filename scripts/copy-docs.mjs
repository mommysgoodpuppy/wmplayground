import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const playgroundRoot = resolve(scriptDir, "..");
const repoRoot = resolve(playgroundRoot, "..", "..");
const sourceRoot = resolve(repoRoot, "docs");
const targetRoot = resolve(playgroundRoot, "public", "docs");

const files = [
  {
    from: resolve(sourceRoot, "workmansyntaxguide.md"),
    to: resolve(targetRoot, "workmansyntaxguide.md"),
  },
  {
    from: resolve(sourceRoot, "workmaninfectionguide.md"),
    to: resolve(targetRoot, "workmaninfectionguide.md"),
  },
  {
    from: resolve(sourceRoot, "reference", "canonical_full_generated.md"),
    to: resolve(targetRoot, "reference", "canonical_full_generated.md"),
  },
];

await Promise.all(
  files.map(async (file) => {
    await mkdir(dirname(file.to), { recursive: true });
    await copyFile(file.from, file.to);
  }),
);
