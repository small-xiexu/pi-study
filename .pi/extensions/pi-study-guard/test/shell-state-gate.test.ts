import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  SHELL_GATE_BLOCK_REASON,
  SHELL_GATE_USER_REJECTION_OUTPUT,
  registerShellGate,
  type ShellGateTraceEntry,
} from "../shell-gate.ts";
import { SHELL_SAFE_COMMAND } from "../shell-policy.ts";

type EventHandler = (event: any, ctx: any) => Promise<unknown> | unknown;

interface ShellStateDecision {
  entry: "tool_call" | "user_bash";
  rule: "safe" | "marker" | "other" | "unclassified" | "error";
  decision: "allow" | "deny";
  reason:
    | "safe"
    | "confirmed"
    | "policy_denied"
    | "no_local_tui"
    | "not_confirmed"
    | "signal_aborted"
    | "policy_error"
    | "ui_error";
}

interface ShellStateSnapshot {
  version: 1;
  mode: "enforce";
  blockedCount: number;
  lastDecision: ShellStateDecision | null;
}

interface ShellStatePort {
  getStatus():
    | "uninitialized"
    | "ready"
    | "invalid"
    | "unsupported_version"
    | "append_failed"
    | "shutdown";
  commitDecision(entry: ShellStateDecision): boolean;
}

const DEFAULT_SNAPSHOT: ShellStateSnapshot = {
  version: 1,
  mode: "enforce",
  blockedCount: 0,
  lastDecision: null,
};

function modelEvent(command: string, toolName = "bash") {
  return {
    type: "tool_call",
    toolName,
    toolCallId: "redacted-test-id",
    input: { command },
  };
}

function userEvent(command: string) {
  return {
    type: "user_bash" as const,
    command,
    cwd: "/redacted/course-root",
    excludeFromContext: false,
  };
}

function createContext() {
  let confirmCount = 0;
  return {
    context: {
      mode: "tui",
      hasUI: true,
      signal: undefined,
      ui: {
        confirm() {
          confirmCount += 1;
          return true;
        },
      },
    },
    get confirmCount() {
      return confirmCount;
    },
  };
}

function createHarness(state: ShellStatePort, onRecord?: (entry: ShellGateTraceEntry) => void) {
  const handlers = new Map<string, EventHandler>();
  const trace: unknown[] = [];

  registerShellGate(
    {
      on(eventName: string, handler: EventHandler) {
        handlers.set(eventName, handler);
      },
    } as unknown as ExtensionAPI,
    {
      state,
      record(entry) {
        onRecord?.(entry);
        trace.push(entry);
      },
    },
  );

  const modelHandler = handlers.get("tool_call");
  const userHandler = handlers.get("user_bash");
  assert.ok(modelHandler);
  assert.ok(userHandler);
  return { modelHandler, trace, userHandler };
}

function assertModelBlocked(result: unknown): void {
  assert.deepEqual(result, { block: true, reason: SHELL_GATE_BLOCK_REASON });
}

function assertUserBlocked(result: unknown): void {
  assert.deepEqual(result, {
    result: {
      output: SHELL_GATE_USER_REJECTION_OUTPUT,
      exitCode: 126,
      cancelled: false,
      truncated: false,
    },
  });
}

async function runModel(handler: EventHandler, event: unknown, context: unknown) {
  const result = await handler(event, context);
  return {
    executorCount: (result as { block?: boolean } | undefined)?.block ? 0 : 1,
    result,
  };
}

async function runUser(handler: EventHandler, event: unknown, context: unknown) {
  const result = await handler(event, context);
  const replacement = result as { result?: unknown; operations?: unknown } | undefined;
  return {
    defaultExecutorCount:
      replacement?.result === undefined && replacement?.operations === undefined ? 1 : 0,
    result,
  };
}

test("every non-ready shared state blocks SAFE at both shell entrances", async (t) => {
  const cases = [
    "uninitialized",
    "invalid",
    "unsupported_version",
    "append_failed",
    "shutdown",
    "throw",
  ] as const;

  for (const stateStatus of cases) {
    await t.test(stateStatus, async () => {
      let statusReads = 0;
      let commitCount = 0;
      const state: ShellStatePort = {
        getStatus() {
          statusReads += 1;
          if (stateStatus === "throw") throw new Error("SECRET_STATUS_FAILURE");
          return stateStatus;
        },
        commitDecision() {
          commitCount += 1;
          return true;
        },
      };
      const harness = createHarness(state);
      const modelContext = createContext();
      const userContext = createContext();

      const model = await runModel(
        harness.modelHandler,
        modelEvent(SHELL_SAFE_COMMAND),
        modelContext.context,
      );
      const user = await runUser(
        harness.userHandler,
        userEvent(SHELL_SAFE_COMMAND),
        userContext.context,
      );

      assertModelBlocked(model.result);
      assertUserBlocked(user.result);
      assert.equal(model.executorCount, 0);
      assert.equal(user.defaultExecutorCount, 0);
      assert.equal(modelContext.confirmCount, 0);
      assert.equal(userContext.confirmCount, 0);
      assert.equal(statusReads, 2);
      assert.equal(commitCount, 0);
      assert.deepEqual(harness.trace, [
        { entry: "tool_call", rule: "error", decision: "deny", reason: "state_error" },
        {
          entry: "user_bash",
          rule: "error",
          decision: "deny",
          reason: "state_error",
          excludeFromContext: false,
        },
      ]);
      assert.equal(JSON.stringify(harness.trace).includes("SECRET_STATUS_FAILURE"), false);
    });
  }
});

test("a false or throwing state commit ends in a traced state_error denial", async (t) => {
  for (const failure of ["false", "throw"] as const) {
    await t.test(failure, async () => {
      const commits: ShellStateDecision[] = [];
      const operationOrder: string[] = [];
      const state: ShellStatePort = {
        getStatus: () => "ready",
        commitDecision(entry) {
          operationOrder.push(`commit:${entry.entry}`);
          commits.push(entry);
          if (failure === "throw") throw new Error("SECRET_STATE_FAILURE");
          return false;
        },
      };
      const harness = createHarness(state, (entry) => {
        operationOrder.push(`trace:${entry.entry}:${entry.reason}`);
      });
      const modelContext = createContext();
      const userContext = createContext();

      const model = await runModel(
        harness.modelHandler,
        modelEvent(SHELL_SAFE_COMMAND),
        modelContext.context,
      );
      assertModelBlocked(model.result);
      assert.equal(model.executorCount, 0);
      const user = await runUser(
        harness.userHandler,
        userEvent(SHELL_SAFE_COMMAND),
        userContext.context,
      );
      assertUserBlocked(user.result);
      assert.equal(user.defaultExecutorCount, 0);
      assert.equal(modelContext.confirmCount, 0);
      assert.equal(userContext.confirmCount, 0);
      assert.deepEqual(commits, [
        { entry: "tool_call", rule: "safe", decision: "allow", reason: "safe" },
        {
          entry: "user_bash",
          rule: "safe",
          decision: "allow",
          reason: "safe",
        },
      ]);
      assert.deepEqual(operationOrder, [
        "commit:tool_call",
        "trace:tool_call:state_error",
        "commit:user_bash",
        "trace:user_bash:state_error",
      ]);
      assert.deepEqual(harness.trace, [
        { entry: "tool_call", rule: "error", decision: "deny", reason: "state_error" },
        {
          entry: "user_bash",
          rule: "error",
          decision: "deny",
          reason: "state_error",
          excludeFromContext: false,
        },
      ]);
      assert.equal(JSON.stringify(harness.trace).includes("SECRET_STATE_FAILURE"), false);
    });
  }
});

test("both shell entrances commit denied decisions through one shared state in order", async () => {
  let snapshot: ShellStateSnapshot = DEFAULT_SNAPSHOT;
  const commits: ShellStateDecision[] = [];
  const state: ShellStatePort = {
    getStatus: () => "ready",
    commitDecision(entry) {
      commits.push(entry);
      snapshot = {
        version: 1,
        mode: "enforce",
        blockedCount: snapshot.blockedCount + (entry.decision === "deny" ? 1 : 0),
        lastDecision: entry,
      };
      return true;
    },
  };
  const harness = createHarness(state);
  const modelContext = createContext();
  const userContext = createContext();

  const model = await runModel(
    harness.modelHandler,
    modelEvent("unknown model command"),
    modelContext.context,
  );
  const user = await runUser(
    harness.userHandler,
    userEvent("unknown user command"),
    userContext.context,
  );

  assertModelBlocked(model.result);
  assertUserBlocked(user.result);
  assert.equal(model.executorCount, 0);
  assert.equal(user.defaultExecutorCount, 0);
  assert.equal(modelContext.confirmCount, 0);
  assert.equal(userContext.confirmCount, 0);
  assert.deepEqual(commits, [
    { entry: "tool_call", rule: "other", decision: "deny", reason: "policy_denied" },
    {
      entry: "user_bash",
      rule: "other",
      decision: "deny",
      reason: "policy_denied",
    },
  ]);
  assert.deepEqual(snapshot, {
    version: 1,
    mode: "enforce",
    blockedCount: 2,
    lastDecision: commits[1],
  });
});

test("a non-bash Tool Call bypasses the state service and remains executable", async () => {
  let stateCallCount = 0;
  const state: ShellStatePort = {
    getStatus() {
      stateCallCount += 1;
      return "ready";
    },
    commitDecision() {
      stateCallCount += 1;
      return true;
    },
  };
  const harness = createHarness(state);
  const gateContext = createContext();
  const model = await runModel(
    harness.modelHandler,
    modelEvent("ignored by the shell gate", "read"),
    gateContext.context,
  );

  assert.equal(model.result, undefined);
  assert.equal(model.executorCount, 1);
  assert.equal(stateCallCount, 0);
  assert.equal(gateContext.confirmCount, 0);
  assert.deepEqual(harness.trace, []);
});
