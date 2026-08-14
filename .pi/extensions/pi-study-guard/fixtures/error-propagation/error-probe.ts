import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const ERROR_PROBE_FLAG = "pi-study-error-mode";
export const ERROR_PROBE_TOOL = "pi_study_error_probe";
export const ERROR_PROBE_MARKER = "PI_STUDY_ERROR_MARKER_5301";
export const ERROR_PROBE_OBSERVER_ERROR = "PI_STUDY_ERROR_OBSERVER_5301";
export const ERROR_PROBE_GATE_ERROR = "PI_STUDY_ERROR_GATE_5301";
export const ERROR_PROBE_EXECUTOR_ERROR = "PI_STUDY_ERROR_EXECUTOR_5301";
export const ERROR_PROBE_SUCCESS_TEXT = "PI_STUDY_ERROR_PROBE_OK";

const DUPLICATE_REASON = "Pi study error probe blocked a duplicate tool call";
const INVALID_CALL_REASON = "Pi study error probe blocked an unexpected tool call";
const INACTIVE_REASON = "Pi study error probe is not armed";

export type ErrorProbeMode = "observer" | "gate" | "executor";

export type ErrorProbeState =
  | "armed"
  | "observer_error"
  | "observer_after"
  | "call_accepted"
  | "gate_error"
  | "gate_after"
  | "executor_start"
  | "executor_error"
  | "executor_success"
  | "tool_result_error"
  | "tool_result_success"
  | "tool_execution_end_error"
  | "tool_execution_end_success"
  | "tool_result_message_error"
  | "tool_result_message_success"
  | "duplicate_blocked"
  | "unexpected_call_blocked"
  | "turn_limit_abort";

export interface ErrorProbeTraceEntry {
  mode: ErrorProbeMode;
  state: ErrorProbeState;
  isError?: boolean;
}

interface ErrorProbeOptions {
  record?: (entry: ErrorProbeTraceEntry) => void;
  stderr?: (message: string) => void;
}

const EMPTY_MARKER_PARAMETERS = {
  type: "object",
  properties: {
    marker: {
      type: "string",
      enum: [ERROR_PROBE_MARKER],
      description: `Must be exactly ${ERROR_PROBE_MARKER}`,
    },
  },
  required: ["marker"],
  additionalProperties: false,
} as const;

function parseMode(value: boolean | string | undefined): ErrorProbeMode | undefined {
  return value === "observer" || value === "gate" || value === "executor" ? value : undefined;
}

function hasExpectedMarker(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    Object.keys(input).length === 1 &&
    "marker" in input &&
    (input as { marker?: unknown }).marker === ERROR_PROBE_MARKER
  );
}

export function registerErrorProbe(pi: ExtensionAPI, options: ErrorProbeOptions = {}): void {
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message));
  let activeMode: ErrorProbeMode | undefined;
  let activationReady = false;
  let activationAttempted = false;
  let toolRegistered = false;
  let observerThrown = false;
  let observerAfterPending = false;
  let matchingCallCount = 0;
  let executorStartCount = 0;
  let turnCount = 0;
  let watchdogTripped = false;
  let duplicateRecorded = false;
  const acceptedEvents = new WeakSet<object>();

  const record = (state: ErrorProbeState, isError?: boolean): void => {
    if (activeMode === undefined || options.record === undefined) {
      throw new Error("PI_STUDY_ERROR_PROBE trace unavailable");
    }

    const entry: ErrorProbeTraceEntry = { mode: activeMode, state };
    if (isError !== undefined) entry.isError = isError;
    options.record(entry);
  };

  const abortDuplicate = (ctx: ExtensionContext): void => {
    ctx.abort();
    if (!duplicateRecorded) {
      duplicateRecorded = true;
      record("duplicate_blocked");
    }
  };

  pi.registerFlag(ERROR_PROBE_FLAG, {
    description: "Select the isolated Pi study error propagation experiment",
    type: "string",
    default: "off",
  });

  pi.on("session_start", () => {
    if (activationAttempted) return;
    activationAttempted = true;

    const rawMode = pi.getFlag(ERROR_PROBE_FLAG);
    if (rawMode === undefined || rawMode === "off") return;

    const mode = parseMode(rawMode);
    if (mode === undefined) {
      stderr("PI_STUDY_ERROR_PROBE disabled: invalid mode\n");
      return;
    }
    if (options.record === undefined) {
      stderr("PI_STUDY_ERROR_PROBE disabled: trace unavailable\n");
      return;
    }

    if (toolRegistered) return;
    pi.registerTool({
      name: ERROR_PROBE_TOOL,
      label: "Pi Study Error Probe",
      description:
        `Return a fixed in-memory study marker. Call once with marker exactly ${ERROR_PROBE_MARKER}.`,
      parameters: EMPTY_MARKER_PARAMETERS,
      executionMode: "sequential",
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (activeMode === undefined || !activationReady) {
          ctx.abort();
          throw new Error(INACTIVE_REASON);
        }
        if (!hasExpectedMarker(params)) {
          ctx.abort();
          throw new Error(INVALID_CALL_REASON);
        }
        if (executorStartCount >= 1) {
          abortDuplicate(ctx);
          throw new Error(DUPLICATE_REASON);
        }

        executorStartCount += 1;
        record("executor_start");
        if (activeMode === "executor") {
          record("executor_error");
          throw new Error(ERROR_PROBE_EXECUTOR_ERROR);
        }

        record("executor_success");
        return {
          content: [{ type: "text", text: ERROR_PROBE_SUCCESS_TEXT }],
          details: { status: "ok" },
        };
      },
    });
    toolRegistered = true;
    activeMode = mode;
    record("armed");
    activationReady = true;
  });

  pi.on("turn_start", (_event, ctx) => {
    if (activeMode === undefined) return;
    if (!activationReady) {
      ctx.abort();
      return;
    }
    turnCount += 1;

    const exceededTurnLimit = matchingCallCount === 0 ? turnCount > 1 : turnCount > 2;
    if (exceededTurnLimit) {
      ctx.abort();
      if (!watchdogTripped) {
        watchdogTripped = true;
        record("turn_limit_abort");
      }
      return;
    }

    if (activeMode === "observer" && !observerThrown) {
      observerThrown = true;
      observerAfterPending = true;
      record("observer_error");
      throw new Error(ERROR_PROBE_OBSERVER_ERROR);
    }
  });

  pi.on("turn_start", () => {
    if (!activationReady || activeMode !== "observer" || !observerAfterPending) return;
    observerAfterPending = false;
    record("observer_after");
  });

  pi.on("tool_call", (event, ctx) => {
    if (activeMode === undefined) return;
    if (!activationReady) {
      ctx.abort();
      return { block: true, reason: INACTIVE_REASON, terminate: true };
    }
    if (event.toolName !== ERROR_PROBE_TOOL || !hasExpectedMarker(event.input)) {
      ctx.abort();
      record("unexpected_call_blocked");
      return { block: true, reason: INVALID_CALL_REASON, terminate: true };
    }

    matchingCallCount += 1;
    if (matchingCallCount > 1) {
      abortDuplicate(ctx);
      return { block: true, reason: DUPLICATE_REASON, terminate: true };
    }

    record("call_accepted");
    if (activeMode === "gate") {
      record("gate_error");
      throw new Error(ERROR_PROBE_GATE_ERROR);
    }

    acceptedEvents.add(event);
  });

  pi.on("tool_call", (event) => {
    if (!activationReady || activeMode === undefined || !acceptedEvents.has(event)) return;
    acceptedEvents.delete(event);
    record("gate_after");
  });

  pi.on("tool_result", (event) => {
    if (!activationReady || activeMode === undefined || event.toolName !== ERROR_PROBE_TOOL) return;
    record(event.isError ? "tool_result_error" : "tool_result_success", event.isError);
  });

  pi.on("tool_execution_end", (event) => {
    if (!activationReady || activeMode === undefined || event.toolName !== ERROR_PROBE_TOOL) return;
    record(
      event.isError ? "tool_execution_end_error" : "tool_execution_end_success",
      event.isError,
    );
  });

  pi.on("message_end", (event) => {
    if (
      !activationReady ||
      activeMode === undefined ||
      event.message.role !== "toolResult" ||
      event.message.toolName !== ERROR_PROBE_TOOL
    ) {
      return;
    }
    record(
      event.message.isError ? "tool_result_message_error" : "tool_result_message_success",
      event.message.isError,
    );
  });
}
