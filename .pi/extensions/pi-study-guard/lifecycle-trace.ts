import { appendFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const LIFECYCLE_TRACE_ENV = "PI_STUDY_LIFECYCLE_TRACE";
export const LIFECYCLE_TRACE_FILE_NAME = "pi-study-lifecycle.log";
export const LIFECYCLE_TRACE_COMMAND = "pi-study-trace";

type TraceDetail = Readonly<Record<string, string>>;

function resolveSafeTracePath(input: string): string {
  const tracePath = resolve(input);
  const tempRoot = realpathSync(tmpdir());
  const traceParent = realpathSync(dirname(tracePath));
  const relativeParent = relative(tempRoot, traceParent);
  const outsideTemp =
    relativeParent === ".." || relativeParent.startsWith(`..${sep}`) || isAbsolute(relativeParent);

  if (basename(tracePath) !== LIFECYCLE_TRACE_FILE_NAME || outsideTemp) {
    throw new Error(`${LIFECYCLE_TRACE_ENV} must point to ${LIFECYCLE_TRACE_FILE_NAME} inside the OS temp directory`);
  }

  if (existsSync(tracePath) && lstatSync(tracePath).isSymbolicLink()) {
    throw new Error(`${LIFECYCLE_TRACE_ENV} must not point to a symbolic link`);
  }

  return tracePath;
}

function safeToken(value: string): string {
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : "redacted";
}

function messageRole(message: { role: string }): string {
  return safeToken(message.role);
}

export function registerLifecycleTrace(pi: ExtensionAPI): void {
  const traceInput = process.env[LIFECYCLE_TRACE_ENV];
  if (traceInput === undefined) return;

  const tracePath = resolveSafeTracePath(traceInput);
  let sequence = 0;
  const trace = (eventName: string, detail: TraceDetail = {}): void => {
    sequence += 1;
    const fields = Object.entries(detail).map(([key, value]) => `${key}=${safeToken(value)}`);
    const suffix = fields.length === 0 ? "" : ` ${fields.join(" ")}`;
    appendFileSync(tracePath, `${String(sequence).padStart(4, "0")} ${eventName}${suffix}\n`, "utf8");
  };

  trace("factory");

  pi.registerCommand(LIFECYCLE_TRACE_COMMAND, {
    description: "Record a lifecycle command marker without logging command arguments",
    handler: async (_args, ctx) => {
      trace("command", { name: LIFECYCLE_TRACE_COMMAND });
      if (ctx.hasUI) ctx.ui.notify("Lifecycle command marker recorded", "info");
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
  pi.on("tool_call", (event) => trace(event.type, { tool: event.toolName }));
  pi.on("tool_result", (event) => trace(event.type, { tool: event.toolName }));
  pi.on("user_bash", (event) => trace(event.type));
  pi.on("model_select", (event) => trace(event.type, { source: event.source }));
}
