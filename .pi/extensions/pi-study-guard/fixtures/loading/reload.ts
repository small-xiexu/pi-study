import { appendFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const RELOAD_MARKER_VERSION = "V1";
const MARKER_FILE_NAME = "pi-study-reload-marker.log";

function resolveSafeMarkerPath(input: string): string {
  const markerPath = resolve(input);
  const tempRoot = realpathSync(tmpdir());
  const markerParent = realpathSync(dirname(markerPath));
  const relativeParent = relative(tempRoot, markerParent);

  const outsideTemp =
    relativeParent === ".." || relativeParent.startsWith(`..${sep}`) || isAbsolute(relativeParent);

  if (basename(markerPath) !== MARKER_FILE_NAME || outsideTemp) {
    throw new Error(`Reload marker must be ${MARKER_FILE_NAME} inside the OS temp directory`);
  }

  if (existsSync(markerPath) && lstatSync(markerPath).isSymbolicLink()) {
    throw new Error("Reload marker must not be a symbolic link");
  }

  return markerPath;
}

export default function registerReloadProbe(pi: ExtensionAPI): void {
  const markerInput = process.env.PI_STUDY_RELOAD_MARKER;
  if (markerInput !== undefined) {
    appendFileSync(resolveSafeMarkerPath(markerInput), `${RELOAD_MARKER_VERSION}\n`, "utf8");
  }

  pi.registerFlag("pi-study-source-reload", {
    description: "[5.1] Loaded by the reload probe",
    type: "boolean",
  });
}
