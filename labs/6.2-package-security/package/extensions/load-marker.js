import { readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function getMarkerDir() {
  const markerDir = process.env.PI_STUDY_62_MARKER_DIR;
  const allowedPrefix = path.join(os.tmpdir(), "pi-study-6.2-package-security-");

  if (
    !markerDir ||
    !path.isAbsolute(markerDir) ||
    path.resolve(markerDir) !== markerDir ||
    !markerDir.startsWith(allowedPrefix) ||
    !statSync(markerDir).isDirectory()
  ) {
    throw new Error("PI_STUDY_62_MARKER_DIR is outside the controlled lab root");
  }
  return markerDir;
}

export default function registerLoadMarker(pi) {
  const countPath = path.join(getMarkerDir(), "load-count.txt");
  let count = 0;
  try {
    count = Number.parseInt(readFileSync(countPath, "utf8"), 10);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Invalid load marker count");
  }
  writeFileSync(countPath, `${count + 1}\n`, "utf8");

  pi.registerFlag("pi-study-package-security-marker", {
    description: "PI_STUDY_PACKAGE_SECURITY_LOAD_MARKER",
    type: "boolean",
    default: false,
  });
}
