import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolCallEventResult,
  type UserBashEventResult,
} from "@earendil-works/pi-coding-agent";

import {
  classifyShellCommand,
  type ShellPolicyDecision,
} from "./shell-policy.ts";
import type {
  ShellStateDecision,
  ShellStateStore,
} from "./shell-state.ts";

export const SHELL_GATE_CONFIRM_TIMEOUT_MS = 10_000;
export const SHELL_GATE_BLOCK_REASON = "PI_STUDY_SHELL_BLOCKED";
export const SHELL_GATE_USER_REJECTION_OUTPUT = `${SHELL_GATE_BLOCK_REASON}\n`;

const CONFIRM_TITLE = "Approve Pi study shell command";
const CONFIRM_MESSAGE = "Allow the fixed course marker command once?";

export interface ShellGateDependencies {
  state: Pick<ShellStateStore, "getStatus" | "commitDecision">;
  classify?: (command: string) => ShellPolicyDecision;
  record?: (entry: ShellGateTraceEntry) => void;
}

export interface ShellGateTraceEntry {
  entry: "tool_call" | "user_bash";
  rule: "safe" | "marker" | "other" | "unclassified" | "error";
  decision: "allow" | "deny";
  reason: ShellStateDecision["reason"] | "state_error";
  excludeFromContext?: boolean;
}

type ShellGateDecision = Omit<ShellStateDecision, "entry">;

const STATE_ERROR_DECISION = {
  rule: "error",
  decision: "deny",
  reason: "state_error",
} as const;

function blockedToolCall(): ToolCallEventResult {
  return {
    block: true,
    reason: SHELL_GATE_BLOCK_REASON,
  };
}

function blockedUserBash(): UserBashEventResult {
  return {
    result: {
      output: SHELL_GATE_USER_REJECTION_OUTPUT,
      exitCode: 126,
      cancelled: false,
      truncated: false,
    },
  };
}

async function decide(
  command: string,
  ctx: ExtensionContext,
  classify: (command: string) => ShellPolicyDecision,
): Promise<ShellGateDecision> {
  try {
    const signal = ctx.signal;
    if (signal?.aborted) {
      return {
        rule: "unclassified",
        decision: "deny",
        reason: "signal_aborted",
      };
    }

    let policyDecision: ShellPolicyDecision;
    try {
      policyDecision = classify(command);
    } catch {
      return { rule: "error", decision: "deny", reason: "policy_error" };
    }

    if (policyDecision === "allow") {
      return signal?.aborted
        ? { rule: "safe", decision: "deny", reason: "signal_aborted" }
        : { rule: "safe", decision: "allow", reason: "safe" };
    }
    if (policyDecision !== "approval_required") {
      return { rule: "other", decision: "deny", reason: "policy_denied" };
    }
    if (ctx.mode !== "tui" || !ctx.hasUI) {
      return { rule: "marker", decision: "deny", reason: "no_local_tui" };
    }

    let confirmed: boolean;
    try {
      confirmed = await ctx.ui.confirm(CONFIRM_TITLE, CONFIRM_MESSAGE, {
        signal,
        timeout: SHELL_GATE_CONFIRM_TIMEOUT_MS,
      });
    } catch {
      return { rule: "marker", decision: "deny", reason: "ui_error" };
    }
    if (confirmed !== true) {
      return { rule: "marker", decision: "deny", reason: "not_confirmed" };
    }
    return signal?.aborted
      ? { rule: "marker", decision: "deny", reason: "signal_aborted" }
      : { rule: "marker", decision: "allow", reason: "confirmed" };
  } catch {
    return { rule: "error", decision: "deny", reason: "policy_error" };
  }
}

export function registerShellGate(
  pi: Pick<ExtensionAPI, "on">,
  dependencies: ShellGateDependencies,
): void {
  const classify = dependencies.classify ?? classifyShellCommand;
  const record = dependencies.record ?? (() => {});
  const state = dependencies.state;
  const stateIsReady = (): boolean => {
    try {
      return state.getStatus() === "ready";
    } catch {
      return false;
    }
  };
  const commitState = (decision: ShellStateDecision): boolean => {
    try {
      return state.commitDecision(decision);
    } catch {
      return false;
    }
  };

  pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | void> => {
    if (!isToolCallEventType("bash", event)) return;

    try {
      if (!stateIsReady()) {
        record({ entry: "tool_call", ...STATE_ERROR_DECISION });
        return blockedToolCall();
      }

      const result = await decide(event.input.command, ctx, classify);
      if (!commitState({ entry: "tool_call", ...result })) {
        record({ entry: "tool_call", ...STATE_ERROR_DECISION });
        return blockedToolCall();
      }
      record({ entry: "tool_call", ...result });
      return result.decision === "allow" ? undefined : blockedToolCall();
    } catch {
      return blockedToolCall();
    }
  });

  pi.on("user_bash", async (event, ctx): Promise<UserBashEventResult | void> => {
    try {
      if (!stateIsReady()) {
        record({
          entry: "user_bash",
          ...STATE_ERROR_DECISION,
          excludeFromContext: event.excludeFromContext,
        });
        return blockedUserBash();
      }

      const result = await decide(event.command, ctx, classify);
      if (!commitState({ entry: "user_bash", ...result })) {
        record({
          entry: "user_bash",
          ...STATE_ERROR_DECISION,
          excludeFromContext: event.excludeFromContext,
        });
        return blockedUserBash();
      }
      record({
        entry: "user_bash",
        ...result,
        excludeFromContext: event.excludeFromContext,
      });
      return result.decision === "allow" ? undefined : blockedUserBash();
    } catch {
      return blockedUserBash();
    }
  });
}
