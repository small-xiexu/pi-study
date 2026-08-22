import { stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const markerDir = process.env.PI_STUDY_62_MARKER_DIR;
const allowedPrefix = path.join(os.tmpdir(), "pi-study-6.2-package-security-");

if (
  !markerDir ||
  !path.isAbsolute(markerDir) ||
  path.resolve(markerDir) !== markerDir ||
  !markerDir.startsWith(allowedPrefix)
) {
  throw new Error("PI_STUDY_62_MARKER_DIR is outside the controlled lab root");
}

const markerDirStat = await stat(markerDir);
if (!markerDirStat.isDirectory()) {
  throw new Error("PI_STUDY_62_MARKER_DIR is not a directory");
}

await writeFile(
  path.join(markerDir, "install-marker.txt"),
  "POSTINSTALL_EXECUTED\n",
  "utf8",
);
