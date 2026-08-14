import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createExtensionRuntime,
  createSyntheticSourceInfo,
  ExtensionRunner,
  type Extension,
  type ExtensionAPI,
  type ToolCallEvent,
  type TurnStartEvent,
} from "@earendil-works/pi-coding-agent";

import {
  ERROR_PROBE_EXECUTOR_ERROR,
  ERROR_PROBE_FLAG,
  ERROR_PROBE_GATE_ERROR,
  ERROR_PROBE_MARKER,
  ERROR_PROBE_OBSERVER_ERROR,
  ERROR_PROBE_SUCCESS_TEXT,
  ERROR_PROBE_TOOL,
  registerErrorProbe,
  type ErrorProbeTraceEntry,
} from "../fixtures/error-propagation/error-probe.ts";
import {
  ERROR_PROBE_TRACE_FILE_NAME,
  registerErrorProbeEntry,
} from "../fixtures/error-propagation/index.ts";

type EventHandler = (event: any, ctx: any) => Promise<unknown> | unknown;
type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];

function createFakeApi() {
  const handlers = new Map<string, EventHandler[]>();
  const flags: Array<{ name: string; options: unknown }> = [];
  const tools: RegisteredTool[] = [];
  let abortCount = 0;
  let flagValue: boolean | string | undefined = "off";

  const api = {
    getFlag(name: string) {
      assert.equal(name, ERROR_PROBE_FLAG);
      return flagValue;
    },
    on(eventName: string, handler: EventHandler) {
      const existing = handlers.get(eventName) ?? [];
      existing.push(handler);
      handlers.set(eventName, existing);
    },
    registerFlag(name: string, options: unknown) {
      flags.push({ name, options });
    },
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    abort() {
      abortCount += 1;
    },
  };

  async function emitOrdinary(eventName: string, event: unknown): Promise<unknown[]> {
    const errors: unknown[] = [];
    for (const handler of handlers.get(eventName) ?? []) {
      try {
        await handler(event, ctx);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  async function emitToolCall(event: unknown): Promise<unknown> {
    let result: unknown;
    for (const handler of handlers.get("tool_call") ?? []) {
      const next = await handler(event, ctx);
      if (next === undefined) continue;
      result = next;
      if (typeof next === "object" && next !== null && "block" in next && next.block === true) {
        return next;
      }
    }
    return result;
  }

  return {
    api,
    ctx,
    emitOrdinary,
    emitToolCall,
    flags,
    get abortCount() {
      return abortCount;
    },
    handlers,
    setFlag(value: boolean | string | undefined) {
      flagValue = value;
    },
    tools,
  };
}

function createHarness(
  mode: string,
  recorderAvailable = true,
  recordFailureState?: ErrorProbeTraceEntry["state"],
) {
  const fake = createFakeApi();
  const trace: ErrorProbeTraceEntry[] = [];
  const stderr: string[] = [];

  registerErrorProbe(fake.api, {
    record: recorderAvailable
      ? (entry) => {
          if (entry.state === recordFailureState) throw new Error("test trace failure");
          trace.push(entry);
        }
      : undefined,
    stderr: (message) => stderr.push(message),
  });

  // Pi applies CLI extension flag values after the factory has registered them.
  fake.setFlag(mode);
  return {
    api: fake.api,
    ctx: fake.ctx,
    emitOrdinary: fake.emitOrdinary,
    emitToolCall: fake.emitToolCall,
    flags: fake.flags,
    get abortCount() {
      return fake.abortCount;
    },
    handlers: fake.handlers,
    setFlag: fake.setFlag,
    tools: fake.tools,
    stderr,
    trace,
  };
}

const sessionStartEvent = { type: "session_start", reason: "startup" };
const turnStartEvent = {
  type: "turn_start",
  turnIndex: 0,
  timestamp: 0,
} satisfies TurnStartEvent;
const targetToolCall = {
  type: "tool_call",
  toolCallId: "fixed-test-id",
  toolName: ERROR_PROBE_TOOL,
  input: { marker: ERROR_PROBE_MARKER },
} satisfies ToolCallEvent;

async function activate(mode: "observer" | "gate" | "executor") {
  const harness = createHarness(mode);
  assert.equal(harness.tools.length, 0);
  assert.deepEqual(await harness.emitOrdinary("session_start", sessionStartEvent), []);
  assert.equal(harness.tools.length, 1);
  return harness;
}

async function executeRegisteredTool(harness: ReturnType<typeof createHarness>) {
  const tool = harness.tools[0];
  assert.ok(tool);
  return tool.execute(
    "fixed-test-id",
    { marker: ERROR_PROBE_MARKER },
    undefined,
    undefined,
    harness.ctx as any,
  );
}

async function emitHostResult(
  harness: ReturnType<typeof createHarness>,
  isError: boolean,
  includeToolResultHandler: boolean,
): Promise<void> {
  if (includeToolResultHandler) {
    await harness.emitOrdinary("tool_result", {
      type: "tool_result",
      toolName: ERROR_PROBE_TOOL,
      isError,
    });
  }
  await harness.emitOrdinary("tool_execution_end", {
    type: "tool_execution_end",
    toolCallId: "fixed-test-id",
    toolName: ERROR_PROBE_TOOL,
    result: {},
    isError,
  });
  await harness.emitOrdinary("message_end", {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "fixed-test-id",
      toolName: ERROR_PROBE_TOOL,
      content: [],
      details: {},
      isError,
      timestamp: 0,
    },
  });
}

async function assertRejectsWithMessage(
  action: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(error.message, expectedMessage);
    return;
  }
  assert.fail(`Expected rejection with ${expectedMessage}`);
}

test("the explicit error probe stays tool-free when off, invalid, or missing its trace sink", async () => {
  const off = createHarness("off");
  const invalid = createHarness("other");
  const missingTrace = createHarness("observer", false);

  assert.deepEqual(off.flags, [
    {
      name: ERROR_PROBE_FLAG,
      options: {
        description: "Select the isolated Pi study error propagation experiment",
        type: "string",
        default: "off",
      },
    },
  ]);
  assert.equal(off.tools.length, 0);
  assert.equal(invalid.tools.length, 0);
  assert.equal(missingTrace.tools.length, 0);

  assert.deepEqual(await off.emitOrdinary("session_start", sessionStartEvent), []);
  assert.deepEqual(await invalid.emitOrdinary("session_start", sessionStartEvent), []);
  assert.deepEqual(await missingTrace.emitOrdinary("session_start", sessionStartEvent), []);

  assert.equal(off.tools.length, 0);
  assert.equal(invalid.tools.length, 0);
  assert.equal(missingTrace.tools.length, 0);
  assert.deepEqual(off.stderr, []);
  assert.deepEqual(invalid.stderr, ["PI_STUDY_ERROR_PROBE disabled: invalid mode\n"]);
  assert.deepEqual(missingTrace.stderr, ["PI_STUDY_ERROR_PROBE disabled: trace unavailable\n"]);
});

test("session activation is idempotent", async () => {
  const harness = await activate("observer");
  assert.deepEqual(await harness.emitOrdinary("session_start", sessionStartEvent), []);
  assert.equal(harness.tools.length, 1);
  assert.deepEqual(harness.trace, [{ mode: "observer", state: "armed" }]);
});

test("an armed trace failure keeps every later turn and tool path fail-closed", async () => {
  const harness = createHarness("observer", true, "armed");

  const activationErrors = await harness.emitOrdinary("session_start", sessionStartEvent);
  assert.equal(activationErrors.length, 1);
  assert.ok(activationErrors[0] instanceof Error);
  assert.equal(activationErrors[0].message, "test trace failure");
  assert.equal(harness.tools.length, 1);
  assert.deepEqual(harness.trace, []);

  assert.deepEqual(await harness.emitOrdinary("turn_start", turnStartEvent), []);
  assert.deepEqual(
    await harness.emitOrdinary("turn_start", { ...turnStartEvent, turnIndex: 1 }),
    [],
  );
  assert.equal(harness.abortCount, 2);

  assert.deepEqual(await harness.emitToolCall(targetToolCall), {
    block: true,
    reason: "Pi study error probe is not armed",
    terminate: true,
  });
  assert.equal(harness.abortCount, 3);

  await assertRejectsWithMessage(
    () => executeRegisteredTool(harness),
    "Pi study error probe is not armed",
  );
  assert.equal(harness.abortCount, 4);
  assert.ok(!harness.trace.some(({ state }) => state === "executor_start"));
  assert.ok(!harness.trace.some(({ state }) => state === "executor_success"));
});

test("observer failure is isolated before the in-memory executor succeeds", async () => {
  const harness = await activate("observer");

  const observerErrors = await harness.emitOrdinary("turn_start", turnStartEvent);
  assert.equal(observerErrors.length, 1);
  const observerError = observerErrors[0];
  assert.ok(observerError instanceof Error);
  assert.equal(observerError.message, ERROR_PROBE_OBSERVER_ERROR);

  assert.equal(await harness.emitToolCall(targetToolCall), undefined);
  const result = await executeRegisteredTool(harness);
  await emitHostResult(harness, false, true);

  assert.deepEqual(result, {
    content: [{ type: "text", text: ERROR_PROBE_SUCCESS_TEXT }],
    details: { status: "ok" },
  });
  assert.deepEqual(harness.trace, [
    { mode: "observer", state: "armed" },
    { mode: "observer", state: "observer_error" },
    { mode: "observer", state: "observer_after" },
    { mode: "observer", state: "call_accepted" },
    { mode: "observer", state: "gate_after" },
    { mode: "observer", state: "executor_start" },
    { mode: "observer", state: "executor_success" },
    { mode: "observer", state: "tool_result_success", isError: false },
    { mode: "observer", state: "tool_execution_end_success", isError: false },
    { mode: "observer", state: "tool_result_message_success", isError: false },
  ]);

  assert.deepEqual(await harness.emitOrdinary("turn_start", { ...turnStartEvent, turnIndex: 1 }), []);
  assert.equal(harness.trace.filter(({ state }) => state === "observer_error").length, 1);
});

test("tool_call gate failure stops later gate handlers and the executor", async () => {
  const harness = await activate("gate");
  assert.deepEqual(await harness.emitOrdinary("turn_start", turnStartEvent), []);

  await assertRejectsWithMessage(
    () => harness.emitToolCall(targetToolCall),
    ERROR_PROBE_GATE_ERROR,
  );
  await emitHostResult(harness, true, false);

  assert.deepEqual(harness.trace, [
    { mode: "gate", state: "armed" },
    { mode: "gate", state: "call_accepted" },
    { mode: "gate", state: "gate_error" },
    { mode: "gate", state: "tool_execution_end_error", isError: true },
    { mode: "gate", state: "tool_result_message_error", isError: true },
  ]);
  assert.ok(!harness.trace.some(({ state }) => state === "gate_after"));
  assert.ok(!harness.trace.some(({ state }) => state === "executor_start"));
  assert.ok(!harness.trace.some(({ state }) => state === "tool_result_error"));
});

test("executor failure is observable without a success marker", async () => {
  const harness = await activate("executor");
  assert.deepEqual(await harness.emitOrdinary("turn_start", turnStartEvent), []);
  assert.equal(await harness.emitToolCall(targetToolCall), undefined);

  await assertRejectsWithMessage(() => executeRegisteredTool(harness), ERROR_PROBE_EXECUTOR_ERROR);
  await emitHostResult(harness, true, true);

  assert.deepEqual(harness.trace, [
    { mode: "executor", state: "armed" },
    { mode: "executor", state: "call_accepted" },
    { mode: "executor", state: "gate_after" },
    { mode: "executor", state: "executor_start" },
    { mode: "executor", state: "executor_error" },
    { mode: "executor", state: "tool_result_error", isError: true },
    { mode: "executor", state: "tool_execution_end_error", isError: true },
    { mode: "executor", state: "tool_result_message_error", isError: true },
  ]);
  assert.ok(!harness.trace.some(({ state }) => state === "executor_success"));
});

test("unexpected and duplicate calls abort without a second executor run", async () => {
  const unexpected = await activate("observer");
  const unexpectedResult = await unexpected.emitToolCall({
    ...targetToolCall,
    input: { marker: ERROR_PROBE_MARKER, extra: true },
  });
  assert.deepEqual(unexpectedResult, {
    block: true,
    reason: "Pi study error probe blocked an unexpected tool call",
    terminate: true,
  });
  assert.equal(unexpected.abortCount, 1);
  assert.equal(unexpected.trace.at(-1)?.state, "unexpected_call_blocked");

  const duplicate = await activate("observer");
  await duplicate.emitOrdinary("turn_start", turnStartEvent);
  assert.equal(await duplicate.emitToolCall(targetToolCall), undefined);
  await executeRegisteredTool(duplicate);
  assert.deepEqual(await duplicate.emitToolCall(targetToolCall), {
    block: true,
    reason: "Pi study error probe blocked a duplicate tool call",
    terminate: true,
  });
  assert.equal(duplicate.abortCount, 1);
  assert.equal(duplicate.trace.filter(({ state }) => state === "executor_start").length, 1);
  assert.equal(duplicate.trace.at(-1)?.state, "duplicate_blocked");
});

test("every turn beyond the limit aborts while its trace marker is recorded once", async () => {
  const harness = await activate("executor");
  await harness.emitOrdinary("turn_start", turnStartEvent);
  assert.equal(await harness.emitToolCall(targetToolCall), undefined);
  await assertRejectsWithMessage(() => executeRegisteredTool(harness), ERROR_PROBE_EXECUTOR_ERROR);

  assert.deepEqual(
    await harness.emitOrdinary("turn_start", { ...turnStartEvent, turnIndex: 1 }),
    [],
  );
  assert.equal(harness.abortCount, 0);
  assert.ok(!harness.trace.some(({ state }) => state === "turn_limit_abort"));

  assert.deepEqual(
    await harness.emitOrdinary("turn_start", { ...turnStartEvent, turnIndex: 2 }),
    [],
  );
  assert.equal(harness.abortCount, 1);
  assert.equal(harness.trace.filter(({ state }) => state === "turn_limit_abort").length, 1);

  assert.deepEqual(
    await harness.emitOrdinary("turn_start", { ...turnStartEvent, turnIndex: 3 }),
    [],
  );
  assert.equal(harness.abortCount, 2);
  assert.equal(harness.trace.filter(({ state }) => state === "turn_limit_abort").length, 1);
});

test("safety aborts happen before duplicate or turn-limit trace failures", async () => {
  const duplicate = createHarness("observer", true, "duplicate_blocked");
  await duplicate.emitOrdinary("session_start", sessionStartEvent);
  await duplicate.emitOrdinary("turn_start", turnStartEvent);
  assert.equal(await duplicate.emitToolCall(targetToolCall), undefined);
  await executeRegisteredTool(duplicate);
  await assertRejectsWithMessage(() => duplicate.emitToolCall(targetToolCall), "test trace failure");
  assert.equal(duplicate.abortCount, 1);

  const turnLimit = createHarness("executor", true, "turn_limit_abort");
  await turnLimit.emitOrdinary("session_start", sessionStartEvent);
  await turnLimit.emitOrdinary("turn_start", turnStartEvent);
  assert.equal(await turnLimit.emitToolCall(targetToolCall), undefined);
  await assertRejectsWithMessage(
    () => executeRegisteredTool(turnLimit),
    ERROR_PROBE_EXECUTOR_ERROR,
  );
  await turnLimit.emitOrdinary("turn_start", { ...turnStartEvent, turnIndex: 1 });

  const firstLimitErrors = await turnLimit.emitOrdinary("turn_start", {
    ...turnStartEvent,
    turnIndex: 2,
  });
  assert.equal(turnLimit.abortCount, 1);
  assert.equal(firstLimitErrors.length, 1);
  assert.ok(firstLimitErrors[0] instanceof Error);
  assert.equal(firstLimitErrors[0].message, "test trace failure");

  assert.deepEqual(
    await turnLimit.emitOrdinary("turn_start", { ...turnStartEvent, turnIndex: 3 }),
    [],
  );
  assert.equal(turnLimit.abortCount, 2);
});

test("Pi ExtensionRunner catches ordinary handler errors but not tool_call gate errors", async () => {
  const order: string[] = [];
  const handlers = new Map<string, EventHandler[]>([
    [
      "turn_start",
      [
        () => {
          order.push("observer_error");
          throw new Error(ERROR_PROBE_OBSERVER_ERROR);
        },
        () => order.push("observer_after"),
      ],
    ],
    [
      "tool_call",
      [
        (event) => {
          order.push("gate_first");
          if (event.input.marker === "throw") throw new Error(ERROR_PROBE_GATE_ERROR);
          return { block: true, reason: "fixed block" };
        },
        () => order.push("gate_after"),
      ],
    ],
  ]);
  const extension = {
    path: "<runner-contract>",
    resolvedPath: "<runner-contract>",
    sourceInfo: createSyntheticSourceInfo("<runner-contract>", { source: "test" }),
    handlers,
    tools: new Map(),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  } as unknown as Extension;
  const runner = new ExtensionRunner(
    [extension],
    createExtensionRuntime(),
    process.cwd(),
    {} as any,
    {} as any,
  );
  const runnerErrors: Array<{ event: string; error: string }> = [];
  runner.onError(({ event, error }) => runnerErrors.push({ event, error }));

  await runner.emit(turnStartEvent);
  assert.deepEqual(order, ["observer_error", "observer_after"]);
  assert.deepEqual(runnerErrors, [
    { event: "turn_start", error: ERROR_PROBE_OBSERVER_ERROR },
  ]);

  await assertRejectsWithMessage(
    () => runner.emitToolCall({ ...targetToolCall, input: { marker: "throw" } }),
    ERROR_PROBE_GATE_ERROR,
  );
  assert.deepEqual(order, ["observer_error", "observer_after", "gate_first"]);

  assert.deepEqual(
    await runner.emitToolCall({ ...targetToolCall, input: { marker: "block" } }),
    { block: true, reason: "fixed block" },
  );
  assert.deepEqual(order, ["observer_error", "observer_after", "gate_first", "gate_first"]);
});

test("the explicit entry writes only fixed trace fields in a new private temp directory", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-study-error-entry-"));
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tracePath = join(root, ERROR_PROBE_TRACE_FILE_NAME);
  const fake = createFakeApi();
  const stderr: string[] = [];

  registerErrorProbeEntry(fake.api, {
    traceInput: tracePath,
    stderr: (message) => stderr.push(message),
  });
  assert.equal(existsSync(tracePath), true);
  assert.equal(readFileSync(tracePath, "utf8"), "");
  assert.equal(fake.tools.length, 0);

  fake.setFlag("executor");
  assert.deepEqual(await fake.emitOrdinary("session_start", sessionStartEvent), []);
  assert.equal(fake.tools.length, 1);
  assert.equal(await fake.emitToolCall(targetToolCall), undefined);
  const tool = fake.tools[0];
  assert.ok(tool);
  await assertRejectsWithMessage(
    () =>
      tool.execute(
        "fixed-test-id",
        { marker: ERROR_PROBE_MARKER },
        undefined,
        undefined,
        fake.ctx as any,
      ),
    ERROR_PROBE_EXECUTOR_ERROR,
  );
  await fake.emitOrdinary("tool_result", {
    type: "tool_result",
    toolName: ERROR_PROBE_TOOL,
    isError: true,
  });
  await fake.emitOrdinary("tool_execution_end", {
    type: "tool_execution_end",
    toolCallId: "fixed-test-id",
    toolName: ERROR_PROBE_TOOL,
    result: {},
    isError: true,
  });
  await fake.emitOrdinary("message_end", {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "fixed-test-id",
      toolName: ERROR_PROBE_TOOL,
      content: [],
      details: {},
      isError: true,
      timestamp: 0,
    },
  });
  assert.deepEqual(await fake.emitOrdinary("session_shutdown", { type: "session_shutdown" }), []);

  assert.deepEqual(stderr, []);
  assert.equal(
    readFileSync(tracePath, "utf8"),
    [
      "0001 error_probe mode=executor state=armed",
      "0002 error_probe mode=executor state=call_accepted",
      "0003 error_probe mode=executor state=gate_after",
      "0004 error_probe mode=executor state=executor_start",
      "0005 error_probe mode=executor state=executor_error",
      "0006 error_probe mode=executor state=tool_result_error isError=true",
      "0007 error_probe mode=executor state=tool_execution_end_error isError=true",
      "0008 error_probe mode=executor state=tool_result_message_error isError=true",
      "",
    ].join("\n"),
  );
});

test("the explicit entry rejects pre-existing targets and non-private temp parents", async (t) => {
  const existingRoot = mkdtempSync(join(tmpdir(), "pi-study-error-existing-"));
  const unsafeRoot = mkdtempSync(join(tmpdir(), "pi-study-error-unsafe-"));
  const symlinkRoot = mkdtempSync(join(tmpdir(), "pi-study-error-symlink-"));
  chmodSync(existingRoot, 0o700);
  chmodSync(unsafeRoot, 0o755);
  chmodSync(symlinkRoot, 0o700);
  t.after(() => {
    chmodSync(unsafeRoot, 0o700);
    rmSync(existingRoot, { recursive: true, force: true });
    rmSync(unsafeRoot, { recursive: true, force: true });
    rmSync(symlinkRoot, { recursive: true, force: true });
  });

  const existingPath = join(existingRoot, ERROR_PROBE_TRACE_FILE_NAME);
  writeFileSync(existingPath, "sentinel\n", "utf8");
  const existing = createFakeApi();
  const existingStderr: string[] = [];
  registerErrorProbeEntry(existing.api, {
    traceInput: existingPath,
    stderr: (message) => existingStderr.push(message),
  });
  existing.setFlag("observer");
  assert.deepEqual(await existing.emitOrdinary("session_start", sessionStartEvent), []);
  assert.equal(existing.tools.length, 0);
  assert.equal(readFileSync(existingPath, "utf8"), "sentinel\n");
  assert.deepEqual(existingStderr, [
    "PI_STUDY_ERROR_PROBE trace initialization failed\n",
    "PI_STUDY_ERROR_PROBE disabled: trace unavailable\n",
  ]);

  const unsafe = createFakeApi();
  const unsafeStderr: string[] = [];
  registerErrorProbeEntry(unsafe.api, {
    traceInput: join(unsafeRoot, ERROR_PROBE_TRACE_FILE_NAME),
    stderr: (message) => unsafeStderr.push(message),
  });
  unsafe.setFlag("gate");
  assert.deepEqual(await unsafe.emitOrdinary("session_start", sessionStartEvent), []);
  assert.equal(unsafe.tools.length, 0);
  assert.deepEqual(unsafeStderr, [
    "PI_STUDY_ERROR_PROBE trace initialization failed\n",
    "PI_STUDY_ERROR_PROBE disabled: trace unavailable\n",
  ]);

  const symlinkPath = join(symlinkRoot, ERROR_PROBE_TRACE_FILE_NAME);
  symlinkSync(existingPath, symlinkPath);
  const symlink = createFakeApi();
  const symlinkStderr: string[] = [];
  registerErrorProbeEntry(symlink.api, {
    traceInput: symlinkPath,
    stderr: (message) => symlinkStderr.push(message),
  });
  symlink.setFlag("executor");
  assert.deepEqual(await symlink.emitOrdinary("session_start", sessionStartEvent), []);
  assert.equal(symlink.tools.length, 0);
  assert.equal(readFileSync(existingPath, "utf8"), "sentinel\n");
  assert.deepEqual(symlinkStderr, [
    "PI_STUDY_ERROR_PROBE trace initialization failed\n",
    "PI_STUDY_ERROR_PROBE disabled: trace unavailable\n",
  ]);
});
