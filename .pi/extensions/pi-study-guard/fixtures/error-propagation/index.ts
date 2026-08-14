import { appendFileSync, closeSync, fstatSync, openSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerErrorProbe, type ErrorProbeTraceEntry } from "./error-probe.ts";

export const ERROR_PROBE_TRACE_ENV = "PI_STUDY_ERROR_TRACE";
export const ERROR_PROBE_TRACE_FILE_NAME = "pi-study-error-probe.log";

interface ErrorProbeRecorder {
  close(): void;
  record(entry: ErrorProbeTraceEntry): void;
}

interface ErrorProbeEntryOptions {
  stderr(message: string): void;
  traceInput: string | undefined;
}

function createRecorder(input: string | undefined): ErrorProbeRecorder | undefined {
  if (input === undefined) return;

  const requestedPath = resolve(input);
  const tempRoot = realpathSync(tmpdir());
  const traceParent = realpathSync(dirname(requestedPath));
  const relativeParent = relative(tempRoot, traceParent);
  const outsideTemp =
    relativeParent === ".." || relativeParent.startsWith(`..${sep}`) || isAbsolute(relativeParent);

  if (basename(requestedPath) !== ERROR_PROBE_TRACE_FILE_NAME || outsideTemp) {
    throw new Error("invalid error probe trace path");
  }

  const parentStats = statSync(traceParent);
  const parentIsPrivate = (parentStats.mode & 0o077) === 0;
  const parentOwnedByProcess =
    typeof process.getuid !== "function" || parentStats.uid === process.getuid();
  if (!parentStats.isDirectory() || !parentIsPrivate || !parentOwnedByProcess) {
    throw new Error("error probe trace parent must be a private directory");
  }

  const tracePath = resolve(traceParent, ERROR_PROBE_TRACE_FILE_NAME);
  const descriptor = openSync(tracePath, "ax", 0o600);
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error("error probe trace must be a regular file");
    }
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }

  let closed = false;
  let sequence = 0;
  return {
    close() {
      if (closed) return;
      closed = true;
      closeSync(descriptor);
    },
    record(entry) {
      if (closed) throw new Error("error probe trace is closed");
      sequence += 1;
      const errorField = entry.isError === undefined ? "" : ` isError=${String(entry.isError)}`;
      appendFileSync(
        descriptor,
        `${String(sequence).padStart(4, "0")} error_probe mode=${entry.mode} state=${entry.state}${errorField}\n`,
        "utf8",
      );
    },
  };
}

export function registerErrorProbeEntry(pi: ExtensionAPI, options: ErrorProbeEntryOptions): void {
  let recorder: ErrorProbeRecorder | undefined;
  try {
    recorder = createRecorder(options.traceInput);
  } catch {
    options.stderr("PI_STUDY_ERROR_PROBE trace initialization failed\n");
  }

  try {
    registerErrorProbe(pi, { record: recorder?.record, stderr: options.stderr });
    if (recorder !== undefined) {
      pi.on("session_shutdown", () => recorder?.close());
    }
  } catch (error) {
    recorder?.close();
    throw error;
  }
}

export default function registerExplicitErrorProbe(pi: ExtensionAPI): void {
  registerErrorProbeEntry(pi, {
    stderr: (message) => process.stderr.write(message),
    traceInput: process.env[ERROR_PROBE_TRACE_ENV],
  });
}
