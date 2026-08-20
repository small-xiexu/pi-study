import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const marker = process.argv[2]?.toUpperCase();

if (marker !== "A" && marker !== "B") {
  console.error("Usage: node switch-local-marker.mjs <A|B> [package-root]");
  process.exitCode = 2;
} else {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultRoot = path.resolve(scriptDir, "../local-package");
  const packageRoot = path.resolve(process.argv[3] ?? defaultRoot);
  const extensionPath = path.join(packageRoot, "extensions/source-marker.js");
  const current = await readFile(extensionPath, "utf8");
  const next = current
    .replace(/pi-study-package-[ab]/g, `pi-study-package-${marker.toLowerCase()}`)
    .replace(/PI_STUDY_PACKAGE_[AB]/g, `PI_STUDY_PACKAGE_${marker}`);

  if (next === current && !current.includes(`PI_STUDY_PACKAGE_${marker}`)) {
    throw new Error("Fixture marker shape is invalid");
  }

  await writeFile(extensionPath, next, "utf8");
  console.log(`local_marker=${marker}`);
}
