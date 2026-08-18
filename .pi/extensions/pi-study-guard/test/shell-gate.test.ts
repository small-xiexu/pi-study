import assert from "node:assert/strict";
import test from "node:test";

import {
  createExtensionRuntime,
  createSyntheticSourceInfo,
  ExtensionRunner,
  type Extension,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import {
  SHELL_GATE_BLOCK_REASON,
  SHELL_GATE_CONFIRM_TIMEOUT_MS,
  SHELL_GATE_USER_REJECTION_OUTPUT,
  registerShellGate,
  type ShellGateDependencies,
} from "../shell-gate.ts";
import type { ShellPolicyDecision } from "../shell-policy.ts";

const SAFE_COMMAND = "printf '%s\\n' PI_STUDY_SHELL_SAFE";
const MARKER_COMMAND =
  "printf '%s\\n' PI_STUDY_SHELL_EXECUTED > PI_STUDY_SHELL_GATE_MARKER.txt";
const BLOCK_REASON = "PI_STUDY_SHELL_BLOCKED";
const REJECTION_OUTPUT = "PI_STUDY_SHELL_BLOCKED\n";

type EventHandler = (event: any, ctx: any) => Promise<unknown> | unknown;
type ExtensionMode = "tui" | "rpc" | "print" | "json";

interface HarnessOptions {
  classify?: (command: string) => ShellPolicyDecision;
}

function createReadyState(): ShellGateDependencies["state"] {
  return {
    getStatus: () => "ready",
    commitDecision: () => true,
  };
}

function createHarness(options: HarnessOptions = {}) {
  const handlers = new Map<string, EventHandler[]>();
  let classifyCount = 0;

  const classify = options.classify ?? ((command: string): ShellPolicyDecision => {
    if (command === SAFE_COMMAND) return "allow";
    if (command === MARKER_COMMAND) return "approval_required";
    return "deny";
  });

  registerShellGate(
    {
      on(eventName: string, handler: EventHandler) {
        const existing = handlers.get(eventName) ?? [];
        existing.push(handler);
        handlers.set(eventName, existing);
      },
    } as unknown as ExtensionAPI,
    {
      state: createReadyState(),
      classify(command) {
        classifyCount += 1;
        return classify(command);
      },
    },
  );

  assert.equal(handlers.get("tool_call")?.length, 1);
  assert.equal(handlers.get("user_bash")?.length, 1);

  return {
    get classifyCount() {
      return classifyCount;
    },
    modelHandler: handlers.get("tool_call")![0]!,
    userHandler: handlers.get("user_bash")![0]!,
  };
}

function createContext(options: {
  mode?: ExtensionMode;
  hasUI?: boolean;
  signal?: AbortSignal;
  confirm?: (opts: { timeout?: number; signal?: AbortSignal }) => Promise<boolean>;
} = {}) {
  let confirmCount = 0;
  let signalReadCount = 0;
  const signal = options.signal;

  return {
    context: {
      mode: options.mode ?? "tui",
      hasUI: options.hasUI ?? true,
      get signal() {
        signalReadCount += 1;
        return signal;
      },
      ui: {
        async confirm(_title: string, _message: string, dialogOptions?: { timeout?: number; signal?: AbortSignal }) {
          confirmCount += 1;
          assert.ok(options.confirm, "confirm must not run for this case");
          return options.confirm(dialogOptions ?? {});
        },
      },
    },
    get confirmCount() {
      return confirmCount;
    },
    get signalReadCount() {
      return signalReadCount;
    },
  };
}

function modelEvent(command: string, toolName = "bash") {
  return {
    type: "tool_call",
    toolName,
    toolCallId: "redacted-test-id",
    input: { command },
  };
}

function userEvent(command: string, excludeFromContext = false) {
  return {
    type: "user_bash" as const,
    command,
    cwd: "/redacted/course-root",
    excludeFromContext,
  };
}

async function runModel(
  handler: EventHandler,
  event: ReturnType<typeof modelEvent>,
  context: unknown,
) {
  let executorCount = 0;
  const result = await handler(event, context);
  if (!(result as { block?: boolean } | undefined)?.block) executorCount += 1;
  return { executorCount, result };
}

async function runUser(
  handler: EventHandler,
  event: ReturnType<typeof userEvent>,
  context: unknown,
) {
  let defaultExecutorCount = 0;
  const result = await handler(event, context);
  const replacement = result as { result?: unknown; operations?: unknown } | undefined;
  if (replacement?.result === undefined && replacement?.operations === undefined) {
    defaultExecutorCount += 1;
  }
  return { defaultExecutorCount, result };
}

function assertModelBlocked(result: unknown): void {
  assert.deepEqual(result, { block: true, reason: BLOCK_REASON });
  assert.equal("terminate" in (result as object), false);
  assert.equal("result" in (result as object), false);
  assert.equal("operations" in (result as object), false);
}

function assertUserBlocked(result: unknown): void {
  assert.deepEqual(result, {
    result: {
      output: REJECTION_OUTPUT,
      exitCode: 126,
      cancelled: false,
      truncated: false,
    },
  });
  assert.equal("block" in (result as object), false);
  assert.equal("operations" in (result as object), false);
}

test("the shell gate exports stable and bounded rejection contracts", () => {
  assert.equal(SHELL_GATE_BLOCK_REASON, BLOCK_REASON);
  assert.equal(SHELL_GATE_USER_REJECTION_OUTPUT, REJECTION_OUTPUT);
  assert.equal(SHELL_GATE_CONFIRM_TIMEOUT_MS, 10_000);
});

test("both shell entrances allow the exact safe command without confirmation", async () => {
  for (const mode of ["tui", "rpc", "print", "json"] as const) {
    const harness = createHarness();
    const modelContext = createContext({ mode, hasUI: mode === "tui" || mode === "rpc" });
    const userContext = createContext({ mode, hasUI: mode === "tui" || mode === "rpc" });
    const model = await runModel(harness.modelHandler, modelEvent(SAFE_COMMAND), modelContext.context);
    const user = await runUser(harness.userHandler, userEvent(SAFE_COMMAND), userContext.context);

    assert.equal(model.result, undefined);
    assert.equal(model.executorCount, 1);
    assert.equal(user.result, undefined);
    assert.equal(user.defaultExecutorCount, 1);
    assert.equal(modelContext.confirmCount, 0);
    assert.equal(userContext.confirmCount, 0);
    assert.equal(modelContext.signalReadCount, 1);
    assert.equal(userContext.signalReadCount, 1);
  }
});

test("the production gate uses the real default shell classifier", async () => {
  const handlers = new Map<string, EventHandler>();
  registerShellGate(
    {
      on(eventName: string, handler: EventHandler) {
        handlers.set(eventName, handler);
      },
    } as unknown as ExtensionAPI,
    { state: createReadyState() },
  );

  const modelHandler = handlers.get("tool_call");
  const userHandler = handlers.get("user_bash");
  assert.ok(modelHandler);
  assert.ok(userHandler);

  assert.equal(
    await modelHandler(modelEvent(SAFE_COMMAND), createContext().context),
    undefined,
  );
  assert.equal(
    await modelHandler(
      modelEvent(MARKER_COMMAND),
      createContext({ confirm: async () => true }).context,
    ),
    undefined,
  );
  assertUserBlocked(
    await userHandler(userEvent("unknown command"), createContext().context),
  );
});

test("a cancelled signal takes priority over the safe allow rule", async () => {
  const controller = new AbortController();
  controller.abort();
  const harness = createHarness();
  const modelContext = createContext({ signal: controller.signal });
  const userContext = createContext({ signal: controller.signal });

  const model = await runModel(harness.modelHandler, modelEvent(SAFE_COMMAND), modelContext.context);
  const user = await runUser(harness.userHandler, userEvent(SAFE_COMMAND), userContext.context);

  assertModelBlocked(model.result);
  assertUserBlocked(user.result);
  assert.equal(model.executorCount, 0);
  assert.equal(user.defaultExecutorCount, 0);
  assert.equal(modelContext.confirmCount, 0);
  assert.equal(userContext.confirmCount, 0);
});

test("the marker command is allowed only after an explicit local TUI confirmation", async () => {
  for (const entrance of ["model", "user"] as const) {
    const harness = createHarness();
    const controller = new AbortController();
    const gateContext = createContext({
      mode: "tui",
      hasUI: true,
      signal: controller.signal,
      confirm: async (dialogOptions) => {
        assert.equal(dialogOptions.timeout, 10_000);
        assert.equal(dialogOptions.signal, controller.signal);
        return true;
      },
    });

    if (entrance === "model") {
      const outcome = await runModel(harness.modelHandler, modelEvent(MARKER_COMMAND), gateContext.context);
      assert.equal(outcome.result, undefined);
      assert.equal(outcome.executorCount, 1);
    } else {
      const outcome = await runUser(harness.userHandler, userEvent(MARKER_COMMAND), gateContext.context);
      assert.equal(outcome.result, undefined);
      assert.equal(outcome.defaultExecutorCount, 1);
    }
    assert.equal(gateContext.confirmCount, 1);
  }
});

test("No, Esc, and timeout all use the same not-confirmed denial branch", async (t) => {
  for (const scenario of ["no", "esc", "timeout"] as const) {
    await t.test(scenario, async () => {
      for (const entrance of ["model", "user"] as const) {
        const harness = createHarness();
        const gateContext = createContext({
          confirm: async (dialogOptions) => {
            assert.equal(dialogOptions.timeout, 10_000);
            return false;
          },
        });

        if (entrance === "model") {
          const outcome = await runModel(harness.modelHandler, modelEvent(MARKER_COMMAND), gateContext.context);
          assertModelBlocked(outcome.result);
          assert.equal(outcome.executorCount, 0);
        } else {
          const outcome = await runUser(harness.userHandler, userEvent(MARKER_COMMAND), gateContext.context);
          assertUserBlocked(outcome.result);
          assert.equal(outcome.defaultExecutorCount, 0);
        }
        assert.equal(gateContext.confirmCount, 1);
      }
    });
  }
});

test("aborting during confirmation still denies even if the dialog returns true", async () => {
  for (const entrance of ["model", "user"] as const) {
    const harness = createHarness();
    const controller = new AbortController();
    const gateContext = createContext({
      signal: controller.signal,
      confirm: async () => {
        controller.abort();
        return true;
      },
    });

    if (entrance === "model") {
      const outcome = await runModel(harness.modelHandler, modelEvent(MARKER_COMMAND), gateContext.context);
      assertModelBlocked(outcome.result);
      assert.equal(outcome.executorCount, 0);
    } else {
      const outcome = await runUser(harness.userHandler, userEvent(MARKER_COMMAND), gateContext.context);
      assertUserBlocked(outcome.result);
      assert.equal(outcome.defaultExecutorCount, 0);
    }
  }
});

test("non-TUI modes and no-UI contexts deny the marker without opening a dialog", async () => {
  const cases = [
    { mode: "rpc" as const, hasUI: true },
    { mode: "print" as const, hasUI: false },
    { mode: "json" as const, hasUI: false },
    { mode: "tui" as const, hasUI: false },
  ];

  for (const current of cases) {
    const harness = createHarness();
    const modelContext = createContext(current);
    const userContext = createContext(current);
    const model = await runModel(harness.modelHandler, modelEvent(MARKER_COMMAND), modelContext.context);
    const user = await runUser(harness.userHandler, userEvent(MARKER_COMMAND), userContext.context);

    assertModelBlocked(model.result);
    assertUserBlocked(user.result);
    assert.equal(model.executorCount, 0);
    assert.equal(user.defaultExecutorCount, 0);
    assert.equal(modelContext.confirmCount, 0);
    assert.equal(userContext.confirmCount, 0);
  }
});

test("policy and UI failures are caught and converted to fixed denials", async (t) => {
  await t.test("policy failure", async () => {
    const harness = createHarness({
      classify() {
        throw new Error("SECRET_POLICY_FAILURE");
      },
    });
    const model = await runModel(harness.modelHandler, modelEvent(MARKER_COMMAND), createContext().context);
    const user = await runUser(harness.userHandler, userEvent(MARKER_COMMAND), createContext().context);

    assertModelBlocked(model.result);
    assertUserBlocked(user.result);
    assert.equal(JSON.stringify([model.result, user.result]).includes("SECRET"), false);
  });

  await t.test("UI failure", async () => {
    const harness = createHarness();
    const failingContext = () => createContext({
      confirm: async () => {
        throw new Error("SECRET_UI_FAILURE");
      },
    });
    const model = await runModel(harness.modelHandler, modelEvent(MARKER_COMMAND), failingContext().context);
    const user = await runUser(harness.userHandler, userEvent(MARKER_COMMAND), failingContext().context);

    assertModelBlocked(model.result);
    assertUserBlocked(user.result);
    assert.equal(JSON.stringify([model.result, user.result]).includes("SECRET"), false);
  });
});

test("unknown commands cannot be approved and non-bash tools bypass the gate", async () => {
  const harness = createHarness();
  const gateContext = createContext({
    confirm: async () => true,
  });
  const model = await runModel(harness.modelHandler, modelEvent("unknown command"), gateContext.context);
  const user = await runUser(harness.userHandler, userEvent("unknown command", true), gateContext.context);

  assertModelBlocked(model.result);
  assertUserBlocked(user.result);
  assert.equal(model.executorCount, 0);
  assert.equal(user.defaultExecutorCount, 0);
  assert.equal(gateContext.confirmCount, 0);

  const beforeClassify = harness.classifyCount;
  assert.equal(
    await harness.modelHandler(
      { type: "tool_call", toolName: "read", toolCallId: "redacted", input: { path: "README.md" } },
      createContext().context,
    ),
    undefined,
  );
  assert.equal(harness.classifyCount, beforeClassify);
});

test("neither adapter mutates the event it inspects", async () => {
  const harness = createHarness();
  const model = modelEvent(SAFE_COMMAND);
  const user = userEvent(SAFE_COMMAND, true);
  const originalModel = structuredClone(model);
  const originalUser = structuredClone(user);

  await harness.modelHandler(model, createContext().context);
  await harness.userHandler(user, createContext().context);

  assert.deepEqual(model, originalModel);
  assert.deepEqual(user, originalUser);
});

test("the shell gate records only fixed decision enums", async () => {
  const entries: unknown[] = [];
  const handlers = new Map<string, EventHandler>();
  registerShellGate(
    {
      on(eventName: string, handler: EventHandler) {
        handlers.set(eventName, handler);
      },
    } as unknown as ExtensionAPI,
    {
      state: createReadyState(),
      record(entry) {
        entries.push(entry);
      },
    },
  );
  const modelHandler = handlers.get("tool_call");
  const userHandler = handlers.get("user_bash");
  assert.ok(modelHandler);
  assert.ok(userHandler);

  await modelHandler(modelEvent(SAFE_COMMAND), createContext().context);
  await userHandler(
    userEvent(MARKER_COMMAND, true),
    createContext({ confirm: async () => true }).context,
  );
  await modelHandler(modelEvent("SECRET_UNKNOWN_COMMAND"), createContext().context);
  await userHandler(
    userEvent(MARKER_COMMAND),
    createContext({ mode: "print", hasUI: false }).context,
  );
  await modelHandler(
    modelEvent(MARKER_COMMAND),
    createContext({ confirm: async () => false }).context,
  );

  assert.deepEqual(entries, [
    { entry: "tool_call", rule: "safe", decision: "allow", reason: "safe" },
    {
      entry: "user_bash",
      rule: "marker",
      decision: "allow",
      reason: "confirmed",
      excludeFromContext: true,
    },
    { entry: "tool_call", rule: "other", decision: "deny", reason: "policy_denied" },
    {
      entry: "user_bash",
      rule: "marker",
      decision: "deny",
      reason: "no_local_tui",
      excludeFromContext: false,
    },
    { entry: "tool_call", rule: "marker", decision: "deny", reason: "not_confirmed" },
  ]);
  assert.equal(JSON.stringify(entries).includes("SECRET_UNKNOWN_COMMAND"), false);
  assert.equal(JSON.stringify(entries).includes(MARKER_COMMAND), false);
});

test("a decision recorder failure is fail-closed for both shell entrances", async () => {
  const handlers = new Map<string, EventHandler>();
  registerShellGate(
    {
      on(eventName: string, handler: EventHandler) {
        handlers.set(eventName, handler);
      },
    } as unknown as ExtensionAPI,
    {
      state: createReadyState(),
      record() {
        throw new Error("SECRET_TRACE_FAILURE");
      },
    },
  );
  const modelHandler = handlers.get("tool_call");
  const userHandler = handlers.get("user_bash");
  assert.ok(modelHandler);
  assert.ok(userHandler);

  const model = await modelHandler(modelEvent(SAFE_COMMAND), createContext().context);
  const user = await userHandler(userEvent(SAFE_COMMAND), createContext().context);

  assertModelBlocked(model);
  assertUserBlocked(user);
  assert.equal(JSON.stringify([model, user]).includes("SECRET_TRACE_FAILURE"), false);
});

function createRunner(handlers: Map<string, EventHandler[]>) {
  const extension = {
    path: "<shell-gate-runner>",
    resolvedPath: "<shell-gate-runner>",
    sourceInfo: createSyntheticSourceInfo("<shell-gate-runner>", { source: "test" }),
    handlers,
    tools: new Map(),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  } as unknown as Extension;

  return new ExtensionRunner(
    [extension],
    createExtensionRuntime(),
    process.cwd(),
    {} as any,
    {} as any,
  );
}

test("a raw user_bash handler failure is fail-open at the Pi runner boundary", async () => {
  let afterFailureCount = 0;
  const runner = createRunner(new Map([
    [
      "user_bash",
      [
        () => {
          throw new Error("SECRET_RAW_HANDLER_FAILURE");
        },
        () => {
          afterFailureCount += 1;
        },
      ],
    ],
  ]));
  const runnerErrors: string[] = [];
  runner.onError(({ error }) => runnerErrors.push(error));

  let defaultExecutorCount = 0;
  const result = await runner.emitUserBash(userEvent(MARKER_COMMAND));
  if (result?.result === undefined && result?.operations === undefined) defaultExecutorCount += 1;

  assert.equal(result, undefined);
  assert.equal(defaultExecutorCount, 1);
  assert.equal(afterFailureCount, 1);
  assert.deepEqual(runnerErrors, ["SECRET_RAW_HANDLER_FAILURE"]);
});

test("the production user adapter closes policy and UI failures at the real runner boundary", async (t) => {
  for (const failure of ["policy", "ui"] as const) {
    await t.test(failure, async () => {
      const handlers = new Map<string, EventHandler[]>();
      registerShellGate(
        {
          on(eventName: string, handler: EventHandler) {
            const existing = handlers.get(eventName) ?? [];
            existing.push(handler);
            handlers.set(eventName, existing);
          },
        } as unknown as ExtensionAPI,
        failure === "policy"
          ? {
              state: createReadyState(),
              classify: () => {
                throw new Error("SECRET_POLICY_FAILURE");
              },
            }
          : { state: createReadyState() },
      );
      const runner = createRunner(handlers);
      if (failure === "ui") {
        runner.setUIContext(
          {
            confirm: async () => {
              throw new Error("SECRET_UI_FAILURE");
            },
          } as any,
          "tui",
        );
      }
      const runnerErrors: string[] = [];
      runner.onError(({ error }) => runnerErrors.push(error));

      let defaultExecutorCount = 0;
      const result = await runner.emitUserBash(userEvent(MARKER_COMMAND));
      if (result?.result === undefined && result?.operations === undefined) defaultExecutorCount += 1;

      assertUserBlocked(result);
      assert.equal(defaultExecutorCount, 0);
      assert.deepEqual(runnerErrors, []);
      assert.equal(JSON.stringify(result).includes("SECRET"), false);
    });
  }
});
