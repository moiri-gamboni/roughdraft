import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceDir = path.join(repoRoot, "docs", "spec");
const destinationDir = path.join(repoRoot, "packages", "app", "dist", "spec");

fs.rmSync(destinationDir, { force: true, recursive: true });
fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
fs.cpSync(sourceDir, destinationDir, { recursive: true });
