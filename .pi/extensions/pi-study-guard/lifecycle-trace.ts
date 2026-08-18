import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { CancelProbeState } from "./cancel-probe.ts";
import type { ShellGateTraceEntry } from "./shell-gate.ts";

export const LIFECYCLE_TRACE_ENV = "PI_STUDY_LIFECYCLE_TRACE";
export const LIFECYCLE_TRACE_FILE_NAME = "pi-study-lifecycle.log";
export const LIFECYCLE_TRACE_COMMAND = "pi-study-trace";
export const LIFECYCLE_TRACE_UNAVAILABLE = "PI_STUDY_LIFECYCLE_TRACE_UNAVAILABLE";

type TraceDetail = Readonly<Record<string, string>>;

interface TraceOutput {
  stderr(message: string): void;
}

interface TraceFileOperations {
  write(descriptor: number, data: Buffer): number;
}

interface TraceFileIdentity {
  device: bigint;
  inode: bigint;
}

export interface LifecycleTraceRecorders {
  cancelProbe(state: CancelProbeState): void;
  shellGate(entry: ShellGateTraceEntry): void;
}

const PROCESS_OUTPUT: TraceOutput = {
  stderr: (message) => {
    process.stderr.write(message);
  },
};

const PROCESS_TRACE_FILE_OPERATIONS: TraceFileOperations = {
  write: (descriptor, data) => writeSync(descriptor, data, 0, data.length),
};

const TRACE_TOOL_NAME_ALLOWLIST = new Set([
  "bash",
  "edit",
  "find",
  "grep",
  "ls",
  "pi_study_inspect",
  "read",
  "write",
]);

const TRACE_MESSAGE_ROLE_ALLOWLIST = new Set([
  "assistant",
  "bashExecution",
  "branchSummary",
  "compactionSummary",
  "custom",
  "toolResult",
  "user",
]);

function resolveSafeTracePath(input: string): string {
  const tracePath = resolve(input);
  const tempRoot = realpathSync(tmpdir());
  const traceParent = realpathSync(dirname(tracePath));
  const parentStat = lstatSync(traceParent, { bigint: true });
  const relativeParent = relative(tempRoot, traceParent);
  const outsideTemp =
    relativeParent === ".." || relativeParent.startsWith(`..${sep}`) || isAbsolute(relativeParent);

  if (basename(tracePath) !== LIFECYCLE_TRACE_FILE_NAME || outsideTemp) {
    throw new Error(`${LIFECYCLE_TRACE_ENV} must point to ${LIFECYCLE_TRACE_FILE_NAME} inside the OS temp directory`);
  }

  const currentUid = typeof process.getuid === "function" ? BigInt(process.getuid()) : parentStat.uid;
  if (!parentStat.isDirectory() || parentStat.uid !== currentUid || (parentStat.mode & 0o077n) !== 0n) {
    throw new Error(`${LIFECYCLE_TRACE_ENV} parent must be a private directory owned by the current user`);
  }

  if (existsSync(tracePath)) {
    const targetStat = lstatSync(tracePath, { bigint: true });
    if (targetStat.isSymbolicLink()) {
      throw new Error(`${LIFECYCLE_TRACE_ENV} must not point to a symbolic link`);
    }
    if (!targetStat.isFile()) {
      throw new Error(`${LIFECYCLE_TRACE_ENV} must point to a regular file`);
    }
  }

  return tracePath;
}

function appendTraceLine(
  tracePath: string,
  line: string,
  fileOperations: TraceFileOperations,
  expectedIdentity: TraceFileIdentity | undefined,
): TraceFileIdentity {
  const descriptor = openSync(
    tracePath,
    constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_CREAT |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  try {
    const targetStat = fstatSync(descriptor, { bigint: true });
    const currentUid = typeof process.getuid === "function" ? BigInt(process.getuid()) : targetStat.uid;
    if (
      !targetStat.isFile() ||
      targetStat.uid !== currentUid ||
      targetStat.nlink !== 1n ||
      (targetStat.mode & 0o077n) !== 0n
    ) {
      throw new Error(`${LIFECYCLE_TRACE_ENV} target must be a private regular file owned by the current user`);
    }
    const identity: TraceFileIdentity = {
      device: targetStat.dev,
      inode: targetStat.ino,
    };
    if (
      expectedIdentity !== undefined &&
      (identity.device !== expectedIdentity.device || identity.inode !== expectedIdentity.inode)
    ) {
      throw new Error(LIFECYCLE_TRACE_UNAVAILABLE);
    }
    const data = Buffer.from(line, "utf8");
    if (fileOperations.write(descriptor, data) !== data.length) {
      throw new Error(LIFECYCLE_TRACE_UNAVAILABLE);
    }
    return identity;
  } finally {
    closeSync(descriptor);
  }
}

function safeToken(value: string): string {
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : "redacted";
}

function traceToolName(toolName: string): string {
  return TRACE_TOOL_NAME_ALLOWLIST.has(toolName) ? toolName : "custom";
}

function messageRole(message: { role: string }): string {
  return TRACE_MESSAGE_ROLE_ALLOWLIST.has(message.role) ? message.role : "custom";
}

function sameWorkingDirectory(cwd: string): boolean {
  try {
    return realpathSync(cwd) === realpathSync(process.cwd());
  } catch {
    return false;
  }
}

function contextSnapshot(ctx: ExtensionCommandContext, route: "ui" | "stderr"): TraceDetail {
  return {
    name: LIFECYCLE_TRACE_COMMAND,
    mode: ctx.mode,
    hasUI: String(ctx.hasUI),
    cwdMatchesProcess: String(sameWorkingDirectory(ctx.cwd)),
    trusted: String(ctx.isProjectTrusted()),
    sessionFile: ctx.sessionManager.getSessionFile() === undefined ? "none" : "present",
    model: ctx.model === undefined ? "none" : "present",
    signal: ctx.signal === undefined ? "none" : "present",
    route,
  };
}

function formatContextSnapshot(snapshot: TraceDetail): string {
  const fields = Object.entries(snapshot).map(([key, value]) => `${key}=${safeToken(value)}`);
  return `PI_STUDY_CONTEXT ${fields.join(" ")}`;
}

export function registerLifecycleTrace(
  pi: ExtensionAPI,
  output: TraceOutput = PROCESS_OUTPUT,
  fileOperations: TraceFileOperations = PROCESS_TRACE_FILE_OPERATIONS,
): LifecycleTraceRecorders | undefined {
  const traceInput = process.env[LIFECYCLE_TRACE_ENV];
  if (traceInput === undefined) return;

  const tracePath = resolveSafeTracePath(traceInput);
  let sequence = 0;
  let traceBroken = false;
  let traceIdentity: TraceFileIdentity | undefined;
  const trace = (eventName: string, detail: TraceDetail = {}): void => {
    if (traceBroken) {
      throw new Error(LIFECYCLE_TRACE_UNAVAILABLE);
    }
    const nextSequence = sequence + 1;
    const fields = Object.entries(detail).map(([key, value]) => `${key}=${safeToken(value)}`);
    const suffix = fields.length === 0 ? "" : ` ${fields.join(" ")}`;
    try {
      traceIdentity = appendTraceLine(
        tracePath,
        `${String(nextSequence).padStart(4, "0")} ${eventName}${suffix}\n`,
        fileOperations,
        traceIdentity,
      );
      sequence = nextSequence;
    } catch {
      traceBroken = true;
      throw new Error(LIFECYCLE_TRACE_UNAVAILABLE);
    }
  };

  trace("factory");

  pi.registerCommand(LIFECYCLE_TRACE_COMMAND, {
    description: "Record a lifecycle command marker without logging command arguments",
    handler: async (_args, ctx) => {
      const route = ctx.hasUI ? "ui" : "stderr";
      const snapshot = contextSnapshot(ctx, route);
      const message = formatContextSnapshot(snapshot);
      trace("command", snapshot);

      if (route === "ui") {
        ctx.ui.notify(message, "info");
      } else {
        output.stderr(`${message}\n`);
      }
    },
  });

  pi.on("session_start", (event) => trace(event.type, { reason: event.reason }));
  pi.on("session_shutdown", (event) => trace(event.type, { reason: event.reason }));
  pi.on("input", (event) => trace(event.type, { source: event.source }));
  pi.on("before_agent_start", (event) => trace(event.type));
  pi.on("agent_start", (event) => trace(event.type));
  pi.on("agent_end", (event) => trace(event.type));
  pi.on("agent_settled", (event) => trace(event.type));
  pi.on("turn_start", (event) => trace(event.type));
  pi.on("turn_end", (event) => trace(event.type));
  pi.on("message_start", (event) => trace(event.type, { role: messageRole(event.message) }));
  pi.on("message_end", (event) => trace(event.type, { role: messageRole(event.message) }));
  pi.on("tool_call", (event) => trace(event.type, { tool: traceToolName(event.toolName) }));
  pi.on("tool_result", (event) => trace(event.type, { tool: traceToolName(event.toolName) }));
  pi.on("user_bash", (event) => trace(event.type));
  pi.on("model_select", (event) => trace(event.type, { source: event.source }));

  return {
    cancelProbe: (state) => trace("cancel_probe", { state }),
    shellGate: (entry) => {
      const detail: TraceDetail = {
        entry: entry.entry,
        rule: entry.rule,
        decision: entry.decision,
        reason: entry.reason,
        ...(entry.excludeFromContext === undefined
          ? {}
          : { excludeFromContext: String(entry.excludeFromContext) }),
      };
      trace("shell_gate", detail);
    },
  };
}
