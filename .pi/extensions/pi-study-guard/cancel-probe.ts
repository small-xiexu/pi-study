import {
  isToolCallEventType,
  type ExtensionAPI,
  type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import {
  runCooperativeDelay,
  type CooperativeDelayTimer,
} from "./fixtures/cancellation/cooperative-delay.ts";

export const CANCEL_PROBE_FLAG = "pi-study-cancel-probe";
export const CANCEL_PROBE_MARKER_PATH = "PI_STUDY_CANCEL_MARKER.txt";
export const CANCEL_PROBE_WAIT_MESSAGE = "PI_STUDY_CANCEL waiting; press Esc";

const CANCEL_PROBE_DELAY_MS = 60_000;
const CANCEL_PROBE_BLOCK_REASON = "Pi study cancellation probe blocked tool execution";

export type CancelProbeState =
  | "blocked_tool"
  | "blocked_path"
  | "missing_signal"
  | "start"
  | "completed"
  | "cancelled"
  | "error";

interface CancelProbeOptions {
  record(state: CancelProbeState): void;
  stderr(message: string): void;
  delayMs?: number;
  timer?: CooperativeDelayTimer;
}

export function registerCancelProbeFlag(pi: ExtensionAPI): void {
  pi.registerFlag(CANCEL_PROBE_FLAG, {
    description: "Enable the opt-in Pi study cancellation probe",
    type: "boolean",
    default: false,
  });
}

export function registerCancelProbe(pi: ExtensionAPI, options: CancelProbeOptions): void {
  const { record, stderr, delayMs = CANCEL_PROBE_DELAY_MS, timer } = options;

  pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | void> => {
    if (pi.getFlag(CANCEL_PROBE_FLAG) !== true) return;

    if (!isToolCallEventType("read", event)) {
      record("blocked_tool");
      return { block: true, reason: CANCEL_PROBE_BLOCK_REASON, terminate: true };
    }

    if (event.input.path !== CANCEL_PROBE_MARKER_PATH) {
      record("blocked_path");
      return { block: true, reason: CANCEL_PROBE_BLOCK_REASON, terminate: true };
    }

    const signal = ctx.signal;
    if (signal === undefined) {
      record("missing_signal");
      return { block: true, reason: CANCEL_PROBE_BLOCK_REASON, terminate: true };
    }

    if (ctx.hasUI) {
      ctx.ui.notify(CANCEL_PROBE_WAIT_MESSAGE, "warning");
    } else {
      stderr(`${CANCEL_PROBE_WAIT_MESSAGE}\n`);
    }

    try {
      await runCooperativeDelay({
        delayMs,
        signal,
        onEvent: record,
        ...(timer === undefined ? {} : { timer }),
      });
    } catch {
      record("error");
    }

    return { block: true, reason: CANCEL_PROBE_BLOCK_REASON, terminate: true };
  });
}
