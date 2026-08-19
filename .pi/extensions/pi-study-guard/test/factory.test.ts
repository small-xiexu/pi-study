import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 默认导出的工厂函数负责产生实际注册行为；GUARD_FLAG 则作为保持不变的期望名称。
import registerPiStudyGuard, { GUARD_FLAG } from "../index.ts";
import { CANCEL_PROBE_FLAG } from "../cancel-probe.ts";
import { INSPECT_COMMAND_NAME } from "../inspect-command.ts";
import { INSPECT_TOOL_NAME } from "../inspect-tool.ts";
import {
  LIFECYCLE_TRACE_COMMAND,
  LIFECYCLE_TRACE_ENV,
  LIFECYCLE_TRACE_FILE_NAME,
  LIFECYCLE_TRACE_UNAVAILABLE,
  registerLifecycleTrace,
} from "../lifecycle-trace.ts";

type FlagOptions = Parameters<ExtensionAPI["registerFlag"]>[1];
type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];
type EventHandler = (event: any, ctx: any) => unknown;
type CommandHandler = (args: string, ctx: any) => unknown;

function restoreEnvironment(previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[LIFECYCLE_TRACE_ENV];
  } else {
    process.env[LIFECYCLE_TRACE_ENV] = previousValue;
  }
}

test("the factory registers the expected marker flag and working Command", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  delete process.env[LIFECYCLE_TRACE_ENV];
  const registrations: Array<{ name: string; options: FlagOptions }> = [];
  const eventNames: string[] = [];
  const toolNames: string[] = [];
  const commands: Array<{ name: string; options: CommandOptions }> = [];
  // 这个 Fake API 不会启动真实 Pi，只负责记录工厂实际传入的注册参数。
  const fakeApi = {
    registerFlag(name: string, options: FlagOptions) {
      registrations.push({ name, options });
    },
    on(eventName: string) {
      eventNames.push(eventName);
    },
    registerTool(tool: RegisteredTool) {
      toolNames.push(tool.name);
    },
    registerCommand(name: string, options: CommandOptions) {
      commands.push({ name, options });
    },
  };

  try {
    registerPiStudyGuard(fakeApi as unknown as ExtensionAPI);
  } finally {
    restoreEnvironment(previousTrace);
  }

  // 比较 Fake 记录的实际行为和预期契约。保持 GUARD_FLAG 不变，
  // 才能让断言发现工厂中硬编码了另一个名称。
  assert.deepEqual(registrations, [
    {
      name: GUARD_FLAG,
      options: {
        description: "Mark the minimal pi-study-guard extension as loaded",
        type: "boolean",
        default: false,
      },
    },
    {
      name: CANCEL_PROBE_FLAG,
      options: {
        description: "Enable the opt-in Pi study cancellation probe",
        type: "boolean",
        default: false,
      },
    },
  ]);
  assert.deepEqual(eventNames, [
    "session_start",
    "session_tree",
    "session_shutdown",
    "tool_call",
    "tool_call",
    "user_bash",
  ]);
  assert.deepEqual(toolNames, [INSPECT_TOOL_NAME]);
  assert.deepEqual(
    commands.map(({ name }) => name),
    [INSPECT_COMMAND_NAME],
  );

  const notifications: Array<{ message: string; level: string }> = [];
  await commands[0]!.options.handler("", {
    hasUI: true,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  } as any);
  assert.deepEqual(notifications, [
    { message: "PI_STUDY_INSPECT_COMMAND_FILE_REQUIRED", level: "error" },
  ]);
});

test("the main factory wires both shell gate adapters with real rejection behavior", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  delete process.env[LIFECYCLE_TRACE_ENV];
  const handlers = new Map<string, EventHandler[]>();
  const appendedState: Array<{ customType: string; data: unknown }> = [];
  let confirmCount = 0;
  const fakeApi = {
    registerFlag() {},
    getFlag() {
      return false;
    },
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
    registerTool() {},
    registerCommand() {},
    appendEntry(customType: string, data: unknown) {
      appendedState.push({ customType, data: structuredClone(data) });
    },
  } as unknown as ExtensionAPI;

  const dispatch = async (eventName: string, event: unknown): Promise<unknown> => {
    const context = {
      mode: "tui",
      hasUI: true,
      signal: undefined,
      sessionManager: {
        getBranch() {
          return [];
        },
      },
      ui: {
        confirm() {
          confirmCount += 1;
          return true;
        },
      },
    };
    for (const handler of handlers.get(eventName) ?? []) {
      const result = await handler(event, context);
      if (result !== undefined) return result;
    }
    return undefined;
  };

  try {
    registerPiStudyGuard(fakeApi);
    assert.equal(
      await dispatch("session_start", { type: "session_start", reason: "startup" }),
      undefined,
    );
    const safeCommand = "printf '%s\\n' PI_STUDY_SHELL_SAFE";
    assert.equal(
      await dispatch("tool_call", {
        type: "tool_call",
        toolName: "bash",
        toolCallId: "redacted-test-id",
        input: { command: safeCommand },
      }),
      undefined,
    );
    assert.equal(
      await dispatch("user_bash", {
        type: "user_bash",
        command: safeCommand,
        cwd: "/redacted/course-root",
        excludeFromContext: false,
      }),
      undefined,
    );
    assert.equal(confirmCount, 0);

    assert.equal(
      await dispatch("tool_call", {
        type: "tool_call",
        toolName: "bash",
        toolCallId: "redacted-test-id",
        input: {
          command:
            "printf '%s\\n' PI_STUDY_SHELL_EXECUTED > PI_STUDY_SHELL_GATE_MARKER.txt",
        },
      }),
      undefined,
    );
    assert.equal(confirmCount, 1);

    assert.deepEqual(
      await dispatch("tool_call", {
        type: "tool_call",
        toolName: "bash",
        toolCallId: "redacted-test-id",
        input: { command: "unknown command" },
      }),
      { block: true, reason: "PI_STUDY_SHELL_BLOCKED" },
    );
    assert.deepEqual(
      await dispatch("user_bash", {
        type: "user_bash",
        command: "unknown command",
        cwd: "/redacted/course-root",
        excludeFromContext: false,
      }),
      {
        result: {
          output: "PI_STUDY_SHELL_BLOCKED\n",
          exitCode: 126,
          cancelled: false,
          truncated: false,
        },
      },
    );
    assert.equal(confirmCount, 1);
    assert.deepEqual(
      appendedState.map(({ data }) => data),
      [
        {
          version: 1,
          mode: "enforce",
          blockedCount: 0,
          lastDecision: {
            entry: "tool_call",
            rule: "safe",
            decision: "allow",
            reason: "safe",
          },
        },
        {
          version: 1,
          mode: "enforce",
          blockedCount: 0,
          lastDecision: {
            entry: "user_bash",
            rule: "safe",
            decision: "allow",
            reason: "safe",
          },
        },
        {
          version: 1,
          mode: "enforce",
          blockedCount: 0,
          lastDecision: {
            entry: "tool_call",
            rule: "marker",
            decision: "allow",
            reason: "confirmed",
          },
        },
        {
          version: 1,
          mode: "enforce",
          blockedCount: 1,
          lastDecision: {
            entry: "tool_call",
            rule: "other",
            decision: "deny",
            reason: "policy_denied",
          },
        },
        {
          version: 1,
          mode: "enforce",
          blockedCount: 2,
          lastDecision: {
            entry: "user_bash",
            rule: "other",
            decision: "deny",
            reason: "policy_denied",
          },
        },
      ],
    );
  } finally {
    restoreEnvironment(previousTrace);
  }
});

test("the main factory renders the Widget after restore and after a committed decision", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  delete process.env[LIFECYCLE_TRACE_ENV];
  const handlers = new Map<string, EventHandler[]>();
  const widgetCalls: Array<{ key: string; content: unknown; options: unknown }> = [];
  const fakeApi = {
    registerFlag() {},
    getFlag() {
      return false;
    },
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
    registerTool() {},
    registerCommand() {},
    appendEntry() {},
  } as unknown as ExtensionAPI;

  const context = {
    mode: "tui",
    hasUI: true,
    signal: undefined,
    sessionManager: {
      getBranch() {
        return [];
      },
    },
    ui: {
      confirm() {
        return true;
      },
      setWidget(key: string, content: unknown, options?: unknown) {
        widgetCalls.push({ key, content, options });
      },
    },
  };

  const dispatch = async (eventName: string, event: unknown): Promise<void> => {
    for (const handler of handlers.get(eventName) ?? []) {
      await handler(event, context);
    }
  };

  try {
    registerPiStudyGuard(fakeApi);
    await dispatch("session_start", { type: "session_start", reason: "startup" });
    assert.equal(widgetCalls.length, 1);
    assert.equal(widgetCalls[0]!.key, "pi-study-guard.shell-state");

    await dispatch("user_bash", {
      type: "user_bash",
      command: "printf '%s\\n' PI_STUDY_SHELL_SAFE",
      cwd: "/redacted/course-root",
      excludeFromContext: false,
    });
    assert.equal(widgetCalls.length, 2);
    assert.equal(widgetCalls[1]!.key, widgetCalls[0]!.key);

    await dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" });
    assert.equal(widgetCalls.length, 3);
    assert.equal(widgetCalls[2]!.content, undefined);
  } finally {
    restoreEnvironment(previousTrace);
  }
});

test("the factory keeps the cancellation gate fail-closed without lifecycle tracing", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  delete process.env[LIFECYCLE_TRACE_ENV];
  const handlers = new Map<string, EventHandler[]>();

  const fakeApi = {
    registerFlag() {},
    getFlag(name: string) {
      assert.equal(name, CANCEL_PROBE_FLAG);
      return true;
    },
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
    registerTool(tool: RegisteredTool) {
      assert.equal(tool.name, INSPECT_TOOL_NAME);
    },
    registerCommand(name: string) {
      assert.equal(name, INSPECT_COMMAND_NAME);
    },
  } as unknown as ExtensionAPI;

  try {
    registerPiStudyGuard(fakeApi);
    assert.equal(handlers.get("tool_call")?.length, 2);
    assert.equal(handlers.get("user_bash")?.length, 1);
    let result: unknown;
    for (const handler of handlers.get("tool_call") ?? []) {
      result = await handler(
        {
          type: "tool_call",
          toolName: "read",
          toolCallId: "redacted-test-id",
          input: { path: "PI_STUDY_CANCEL_MARKER.txt" },
        },
        { signal: undefined },
      );
      if (result !== undefined) break;
    }
    assert.deepEqual(
      result,
      {
        block: true,
        reason: "Pi study cancellation probe blocked tool execution",
        terminate: true,
      },
    );
  } finally {
    restoreEnvironment(previousTrace);
  }
});

test("the main factory observes tool calls before cancellation short-circuits the shell gate", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  const traceRoot = mkdtempSync(join(tmpdir(), "pi-study-handler-order-test."));
  const tracePath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
  const handlers = new Map<string, EventHandler[]>();
  let confirmCount = 0;

  const fakeApi = {
    registerFlag() {},
    getFlag(name: string) {
      assert.equal(name, CANCEL_PROBE_FLAG);
      return true;
    },
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
    registerTool() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;

  const dispatchToolCall = async (event: unknown): Promise<unknown> => {
    for (const handler of handlers.get("tool_call") ?? []) {
      const result = await handler(event, {
        mode: "tui",
        hasUI: true,
        signal: undefined,
        ui: {
          confirm() {
            confirmCount += 1;
            return true;
          },
        },
      });
      if (result !== undefined) return result;
    }
    return undefined;
  };

  process.env[LIFECYCLE_TRACE_ENV] = tracePath;
  try {
    registerPiStudyGuard(fakeApi);

    assert.deepEqual(
      await dispatchToolCall({
        type: "tool_call",
        toolName: "read",
        toolCallId: "redacted-test-id",
        input: { path: "PI_STUDY_CANCEL_MARKER.txt" },
      }),
      {
        block: true,
        reason: "Pi study cancellation probe blocked tool execution",
        terminate: true,
      },
    );

    assert.deepEqual(
      await dispatchToolCall({
        type: "tool_call",
        toolName: "bash",
        toolCallId: "redacted-test-id",
        input: {
          command:
            "printf '%s\\n' PI_STUDY_SHELL_EXECUTED > PI_STUDY_SHELL_GATE_MARKER.txt",
        },
      }),
      {
        block: true,
        reason: "Pi study cancellation probe blocked tool execution",
        terminate: true,
      },
    );

    assert.equal(confirmCount, 0);
    assert.deepEqual(readFileSync(tracePath, "utf8").trimEnd().split("\n"), [
      "0001 factory",
      "0002 tool_call tool=read",
      "0003 cancel_probe state=missing_signal",
      "0004 tool_call tool=bash",
      "0005 cancel_probe state=blocked_tool",
    ]);
  } finally {
    restoreEnvironment(previousTrace);
    rmSync(traceRoot, { recursive: true, force: true });
  }
});

test("the trace mode records only the lifecycle allowlist", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  const traceRoot = mkdtempSync(join(tmpdir(), "pi-study-lifecycle-test."));
  const tracePath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
  const handlers = new Map<string, EventHandler[]>();
  const commandHandlers = new Map<string, CommandHandler>();
  const notifications: Array<{ message: string; level: string }> = [];

  const fakeApi = {
    registerFlag() {},
    getFlag() {
      return false;
    },
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commandHandlers.set(name, options.handler);
    },
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
    registerTool(tool: RegisteredTool) {
      assert.equal(tool.name, INSPECT_TOOL_NAME);
    },
    appendEntry() {},
  } as unknown as ExtensionAPI;

  const invoke = async (
    eventName: string,
    event: Record<string, unknown>,
    context: Record<string, unknown> = {},
  ): Promise<void> => {
    const registered = handlers.get(eventName);
    assert.ok(registered, `missing ${eventName} handler`);
    for (const handler of registered) {
      await handler(event, context);
    }
  };

  process.env[LIFECYCLE_TRACE_ENV] = tracePath;
  try {
    registerPiStudyGuard(fakeApi);
    assert.deepEqual([...commandHandlers.keys()], [
      LIFECYCLE_TRACE_COMMAND,
      INSPECT_COMMAND_NAME,
    ]);
    const commandHandler = commandHandlers.get(LIFECYCLE_TRACE_COMMAND);
    assert.ok(commandHandler);

    await invoke(
      "session_start",
      { type: "session_start", reason: "startup" },
      { sessionManager: { getBranch: () => [] } },
    );
    await commandHandler("SECRET_ARGUMENT", {
      mode: "tui",
      hasUI: true,
      cwd: process.cwd(),
      isProjectTrusted: () => false,
      sessionManager: { getSessionFile: () => undefined },
      model: undefined,
      signal: undefined,
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    });
    await invoke("user_bash", {
      type: "user_bash",
      command: "SECRET_COMMAND",
      excludeFromContext: false,
      cwd: "/SECRET/PATH",
    });
    await invoke("model_select", { type: "model_select", source: "cycle" });
    await invoke("input", { type: "input", text: "SECRET_PROMPT", source: "interactive" });
    await invoke("before_agent_start", { type: "before_agent_start", prompt: "SECRET_PROMPT" });
    await invoke("agent_start", { type: "agent_start" });
    await invoke("message_start", { type: "message_start", message: { role: "user" } });
    await invoke("turn_start", { type: "turn_start" });
    await invoke("tool_call", {
      type: "tool_call",
      toolName: "read",
      input: { path: "/SECRET/PATH" },
    });
    await invoke("tool_result", {
      type: "tool_result",
      toolName: "read",
      content: [{ type: "text", text: "SECRET_RESULT" }],
    });
    await invoke("tool_call", {
      type: "tool_call",
      toolName: "SECRET_TOKEN_123",
      input: {},
    });
    await invoke("tool_result", {
      type: "tool_result",
      toolName: "SECRET_TOKEN_123",
      content: [],
    });
    await invoke("message_start", {
      type: "message_start",
      message: { role: "SECRET_TOKEN_123" },
    });
    await invoke("message_end", {
      type: "message_end",
      message: { role: "SECRET_TOKEN_123" },
    });
    await invoke("message_end", { type: "message_end", message: { role: "assistant" } });
    await invoke("turn_end", { type: "turn_end" });
    await invoke("agent_end", { type: "agent_end", messages: ["SECRET_MESSAGE"] });
    await invoke("agent_settled", { type: "agent_settled" });
    await invoke("session_shutdown", { type: "session_shutdown", reason: "quit" });

    assert.deepEqual(readFileSync(tracePath, "utf8").trimEnd().split("\n"), [
      "0001 factory",
      "0002 session_start reason=startup",
      "0003 command name=pi-study-trace mode=tui hasUI=true cwdMatchesProcess=true trusted=false sessionFile=none model=none signal=none route=ui",
      "0004 user_bash",
      "0005 shell_gate entry=user_bash rule=other decision=deny reason=policy_denied excludeFromContext=false",
      "0006 model_select source=cycle",
      "0007 input source=interactive",
      "0008 before_agent_start",
      "0009 agent_start",
      "0010 message_start role=user",
      "0011 turn_start",
      "0012 tool_call tool=read",
      "0013 tool_result tool=read",
      "0014 tool_call tool=custom",
      "0015 tool_result tool=custom",
      "0016 message_start role=custom",
      "0017 message_end role=custom",
      "0018 message_end role=assistant",
      "0019 turn_end",
      "0020 agent_end",
      "0021 agent_settled",
      "0022 session_shutdown reason=quit",
    ]);

    assert.deepEqual(notifications, [
      {
        message:
          "PI_STUDY_CONTEXT name=pi-study-trace mode=tui hasUI=true cwdMatchesProcess=true trusted=false sessionFile=none model=none signal=none route=ui",
        level: "info",
      },
    ]);

    const trace = readFileSync(tracePath, "utf8");
    for (const secret of [
      "SECRET_ARGUMENT",
      "SECRET_COMMAND",
      "SECRET_PROMPT",
      "/SECRET/PATH",
      "SECRET_RESULT",
      "SECRET_MESSAGE",
      "SECRET_TOKEN_123",
    ]) {
      assert.equal(trace.includes(secret), false, `trace leaked ${secret}`);
    }
  } finally {
    restoreEnvironment(previousTrace);
    rmSync(traceRoot, { recursive: true, force: true });
  }
});

test("the lifecycle trace keeps only the fixed Tool name allowlist", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  const traceRoot = mkdtempSync(join(tmpdir(), "pi-study-lifecycle-tool-name-test."));
  const tracePath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
  const handlers = new Map<string, EventHandler[]>();
  const toolNameCases = [
    ["bash", "bash"],
    ["edit", "edit"],
    ["find", "find"],
    ["grep", "grep"],
    ["ls", "ls"],
    ["pi_study_inspect", "pi_study_inspect"],
    ["read", "read"],
    ["write", "write"],
    ["SECRET_TOKEN_123", "custom"],
  ] as const;

  const fakeApi = {
    registerCommand() {},
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
  } as unknown as ExtensionAPI;

  process.env[LIFECYCLE_TRACE_ENV] = tracePath;
  try {
    registerLifecycleTrace(fakeApi);
    for (const [inputName] of toolNameCases) {
      for (const eventName of ["tool_call", "tool_result"] as const) {
        const handler = handlers.get(eventName)?.[0];
        assert.ok(handler);
        await handler({ type: eventName, toolName: inputName }, {});
      }
    }

    const expected = ["0001 factory"];
    let sequence = 2;
    for (const [, outputName] of toolNameCases) {
      expected.push(`${String(sequence++).padStart(4, "0")} tool_call tool=${outputName}`);
      expected.push(`${String(sequence++).padStart(4, "0")} tool_result tool=${outputName}`);
    }
    assert.deepEqual(readFileSync(tracePath, "utf8").trimEnd().split("\n"), expected);
    assert.equal(readFileSync(tracePath, "utf8").includes("SECRET_TOKEN_123"), false);
  } finally {
    restoreEnvironment(previousTrace);
    rmSync(traceRoot, { recursive: true, force: true });
  }
});

test("the trace command routes UI and no-UI modes without leaking context values", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  const traceRoot = mkdtempSync(join(tmpdir(), "pi-study-context-test."));
  const tracePath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
  let commandHandler: CommandHandler | undefined;
  const stderr: string[] = [];
  const notifications: string[] = [];

  const fakeApi = {
    getFlag() {
      return false;
    },
    registerCommand(name: string, options: { handler: CommandHandler }) {
      assert.equal(name, LIFECYCLE_TRACE_COMMAND);
      commandHandler = options.handler;
    },
    on() {},
  } as unknown as ExtensionAPI;

  const noUi = {
    hasUI: false,
    ui: {
      notify() {
        assert.fail("no-UI modes must not call ui.notify");
      },
    },
  };

  process.env[LIFECYCLE_TRACE_ENV] = tracePath;
  try {
    registerLifecycleTrace(fakeApi, {
      stderr: (message) => stderr.push(message),
    });
    assert.ok(commandHandler);

    await commandHandler("SECRET_PRINT_ARGUMENT", {
      ...noUi,
      mode: "print",
      cwd: process.cwd(),
      isProjectTrusted: () => false,
      sessionManager: { getSessionFile: () => undefined },
      model: undefined,
      signal: undefined,
    });
    await commandHandler("SECRET_JSON_ARGUMENT", {
      ...noUi,
      mode: "json",
      cwd: "/SECRET/CWD",
      isProjectTrusted: () => true,
      sessionManager: { getSessionFile: () => "/SECRET/SESSION.jsonl" },
      model: { id: "SECRET_MODEL" },
      signal: new AbortController().signal,
    });
    await commandHandler("SECRET_RPC_ARGUMENT", {
      mode: "rpc",
      hasUI: true,
      cwd: process.cwd(),
      isProjectTrusted: () => false,
      sessionManager: { getSessionFile: () => undefined },
      model: undefined,
      signal: undefined,
      ui: {
        notify(message: string) {
          notifications.push(message);
        },
      },
    });

    assert.deepEqual(stderr, [
      "PI_STUDY_CONTEXT name=pi-study-trace mode=print hasUI=false cwdMatchesProcess=true trusted=false sessionFile=none model=none signal=none route=stderr\n",
      "PI_STUDY_CONTEXT name=pi-study-trace mode=json hasUI=false cwdMatchesProcess=false trusted=true sessionFile=present model=present signal=present route=stderr\n",
    ]);
    assert.deepEqual(notifications, [
      "PI_STUDY_CONTEXT name=pi-study-trace mode=rpc hasUI=true cwdMatchesProcess=true trusted=false sessionFile=none model=none signal=none route=ui",
    ]);
    assert.deepEqual(readFileSync(tracePath, "utf8").trimEnd().split("\n"), [
      "0001 factory",
      "0002 command name=pi-study-trace mode=print hasUI=false cwdMatchesProcess=true trusted=false sessionFile=none model=none signal=none route=stderr",
      "0003 command name=pi-study-trace mode=json hasUI=false cwdMatchesProcess=false trusted=true sessionFile=present model=present signal=present route=stderr",
      "0004 command name=pi-study-trace mode=rpc hasUI=true cwdMatchesProcess=true trusted=false sessionFile=none model=none signal=none route=ui",
    ]);

    const trace = readFileSync(tracePath, "utf8");
    const allOutput = `${trace}\n${stderr.join("")}\n${notifications.join("")}`;
    for (const secret of [
      "SECRET_PRINT_ARGUMENT",
      "SECRET_JSON_ARGUMENT",
      "SECRET_RPC_ARGUMENT",
      "/SECRET/CWD",
      "/SECRET/SESSION.jsonl",
      "SECRET_MODEL",
    ]) {
      assert.equal(allOutput.includes(secret), false, `context output leaked ${secret}`);
    }
  } finally {
    restoreEnvironment(previousTrace);
    rmSync(traceRoot, { recursive: true, force: true });
  }
});

test("the trace mode rejects unsafe trace paths", () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  const traceRoot = mkdtempSync(join(tmpdir(), "pi-study-lifecycle-path-test."));
  process.env[LIFECYCLE_TRACE_ENV] = join(traceRoot, "wrong-name.log");

  try {
    assert.throws(
      () => registerLifecycleTrace({} as ExtensionAPI),
      new RegExp(`${LIFECYCLE_TRACE_FILE_NAME} inside the OS temp directory`),
    );

    process.env[LIFECYCLE_TRACE_ENV] = join(process.cwd(), LIFECYCLE_TRACE_FILE_NAME);
    assert.throws(
      () => registerLifecycleTrace({} as ExtensionAPI),
      new RegExp(`${LIFECYCLE_TRACE_FILE_NAME} inside the OS temp directory`),
    );

    const symlinkTarget = join(traceRoot, "target.log");
    const symlinkPath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
    writeFileSync(symlinkTarget, "", "utf8");
    symlinkSync(symlinkTarget, symlinkPath);
    process.env[LIFECYCLE_TRACE_ENV] = symlinkPath;
    assert.throws(
      () => registerLifecycleTrace({} as ExtensionAPI),
      /must not point to a symbolic link/,
    );

    rmSync(symlinkPath);
    mkdirSync(symlinkPath);
    assert.throws(
      () => registerLifecycleTrace({} as ExtensionAPI),
      /must point to a regular file/,
    );

    rmSync(symlinkPath, { recursive: true });
    execFileSync("mkfifo", [symlinkPath]);
    assert.throws(
      () => registerLifecycleTrace({} as ExtensionAPI),
      /must point to a regular file/,
    );

    rmSync(symlinkPath);
    writeFileSync(symlinkPath, "", { encoding: "utf8", mode: 0o644 });
    assert.throws(
      () => registerLifecycleTrace({} as ExtensionAPI),
      new RegExp(LIFECYCLE_TRACE_UNAVAILABLE),
    );

    rmSync(symlinkPath);
    chmodSync(traceRoot, 0o755);
    assert.throws(
      () => registerLifecycleTrace({} as ExtensionAPI),
      /parent must be a private directory owned by the current user/,
    );
  } finally {
    restoreEnvironment(previousTrace);
    rmSync(traceRoot, { recursive: true, force: true });
  }
});

test("the main factory keeps the shell gate fail-closed when trace initialization fails", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  const traceRoot = mkdtempSync(join(tmpdir(), "pi-study-lifecycle-init-failure-test."));
  const handlers = new Map<string, EventHandler[]>();
  const tracePath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
  const hardLinkSource = join(traceRoot, "hard-link-source.log");
  writeFileSync(hardLinkSource, "", { encoding: "utf8", mode: 0o600 });
  linkSync(hardLinkSource, tracePath);
  process.env[LIFECYCLE_TRACE_ENV] = tracePath;

  const fakeApi = {
    registerFlag() {},
    getFlag() {
      return false;
    },
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
    registerTool() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;

  const dispatch = async (eventName: string, event: unknown): Promise<unknown> => {
    for (const handler of handlers.get(eventName) ?? []) {
      const result = await handler(event, {
        mode: "tui",
        hasUI: true,
        signal: undefined,
        ui: { confirm: () => assert.fail("trace initialization failure must deny before UI") },
      });
      if (result !== undefined) return result;
    }
    return undefined;
  };

  try {
    assert.doesNotThrow(() => registerPiStudyGuard(fakeApi));
    assert.deepEqual(
      await dispatch("tool_call", {
        type: "tool_call",
        toolName: "bash",
        toolCallId: "redacted-test-id",
        input: { command: "printf '%s\\n' PI_STUDY_SHELL_SAFE" },
      }),
      { block: true, reason: "PI_STUDY_SHELL_BLOCKED" },
    );
    assert.deepEqual(
      await dispatch("user_bash", {
        type: "user_bash",
        command: "printf '%s\\n' PI_STUDY_SHELL_SAFE",
        cwd: "/redacted/course-root",
        excludeFromContext: false,
      }),
      {
        result: {
          output: "PI_STUDY_SHELL_BLOCKED\n",
          exitCode: 126,
          cancelled: false,
          truncated: false,
        },
      },
    );
  } finally {
    restoreEnvironment(previousTrace);
    rmSync(traceRoot, { recursive: true, force: true });
  }
});

test("a runtime trace failure stays latched so a later shell decision cannot fail open", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  const traceRoot = mkdtempSync(join(tmpdir(), "pi-study-SECRET-runtime-failure-test."));
  const tracePath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
  const handlers = new Map<string, EventHandler[]>();
  const appendedEntries: Array<{ customType: string; data: unknown }> = [];
  process.env[LIFECYCLE_TRACE_ENV] = tracePath;

  const fakeApi = {
    registerFlag() {},
    getFlag() {
      return false;
    },
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
    registerTool() {},
    registerCommand() {},
    appendEntry(customType: string, data: unknown) {
      appendedEntries.push({ customType, data });
    },
  } as unknown as ExtensionAPI;
  const event = {
    type: "user_bash",
    command: "printf '%s\\n' PI_STUDY_SHELL_SAFE",
    cwd: "/redacted/course-root",
    excludeFromContext: false,
  };
  const context = {
    mode: "tui",
    hasUI: true,
    signal: undefined,
    ui: { confirm: () => assert.fail("safe command must not ask for confirmation") },
  };

  try {
    registerPiStudyGuard(fakeApi);
    const sessionStartHandlers = handlers.get("session_start");
    assert.equal(sessionStartHandlers?.length, 2);
    for (const handler of sessionStartHandlers ?? []) {
      await handler(
        { type: "session_start", reason: "startup" },
        {
          ...context,
          sessionManager: { getBranch: () => [] },
        },
      );
    }
    const userBashHandlers = handlers.get("user_bash");
    assert.equal(userBashHandlers?.length, 2);
    assert.deepEqual(readFileSync(tracePath, "utf8").trimEnd().split("\n"), [
      "0001 factory",
      "0002 session_start reason=startup",
    ]);

    rmSync(traceRoot, { recursive: true, force: true });
    let traceError: unknown;
    try {
      userBashHandlers![0]!(event, context);
      assert.fail("runtime trace write must fail when its parent disappears");
    } catch (error) {
      traceError = error;
    }
    assert.equal(traceError instanceof Error, true);
    assert.equal((traceError as Error).message, LIFECYCLE_TRACE_UNAVAILABLE);
    assert.equal(String(traceError).includes(traceRoot), false);

    mkdirSync(traceRoot, { mode: 0o700 });
    writeFileSync(tracePath, "0001 factory\n", { encoding: "utf8", mode: 0o600 });
    assert.deepEqual(
      await userBashHandlers![1]!(event, context),
      {
        result: {
          output: "PI_STUDY_SHELL_BLOCKED\n",
          exitCode: 126,
          cancelled: false,
          truncated: false,
        },
      },
    );
    assert.deepEqual(appendedEntries, [
      {
        customType: "pi-study-guard.shell-gate-state",
        data: {
          version: 1,
          mode: "enforce",
          blockedCount: 0,
          lastDecision: {
            entry: "user_bash",
            rule: "safe",
            decision: "allow",
            reason: "safe",
          },
        },
      },
    ]);
    assert.deepEqual(readFileSync(tracePath, "utf8").trimEnd().split("\n"), ["0001 factory"]);
  } finally {
    restoreEnvironment(previousTrace);
    rmSync(traceRoot, { recursive: true, force: true });
  }
});

test("a short trace write fails and latches before a later shell decision", () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  const traceRoot = mkdtempSync(join(tmpdir(), "pi-study-lifecycle-short-write-test."));
  const tracePath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
  const handlers = new Map<string, EventHandler[]>();
  let forceShortWrite = false;
  process.env[LIFECYCLE_TRACE_ENV] = tracePath;

  const fakeApi = {
    registerCommand() {},
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
  } as unknown as ExtensionAPI;

  try {
    const recorders = registerLifecycleTrace(fakeApi, undefined, {
      write(descriptor, data) {
        const length = forceShortWrite ? 1 : data.length;
        return writeSync(descriptor, data, 0, length);
      },
    });
    assert.ok(recorders);
    const userBashObserver = handlers.get("user_bash")?.[0];
    assert.ok(userBashObserver);

    forceShortWrite = true;
    assert.throws(
      () => userBashObserver(
        {
          type: "user_bash",
          command: "SECRET_COMMAND",
          cwd: "/SECRET/PATH",
          excludeFromContext: false,
        },
        {},
      ),
      new RegExp(LIFECYCLE_TRACE_UNAVAILABLE),
    );

    forceShortWrite = false;
    assert.throws(
      () => recorders.shellGate({
        entry: "user_bash",
        rule: "safe",
        decision: "allow",
        reason: "safe",
        excludeFromContext: false,
      }),
      new RegExp(LIFECYCLE_TRACE_UNAVAILABLE),
    );
    assert.equal(readFileSync(tracePath, "utf8").includes("SECRET"), false);
  } finally {
    restoreEnvironment(previousTrace);
    rmSync(traceRoot, { recursive: true, force: true });
  }
});

test("replacing the trace file with another private inode latches the shell gate", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  const traceRoot = mkdtempSync(join(tmpdir(), "pi-study-lifecycle-replacement-test."));
  const tracePath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
  const originalTracePath = join(traceRoot, "original.log");
  const handlers = new Map<string, EventHandler[]>();
  process.env[LIFECYCLE_TRACE_ENV] = tracePath;

  const fakeApi = {
    registerFlag() {},
    getFlag() {
      return false;
    },
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
    registerTool() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;
  const event = {
    type: "user_bash",
    command: "printf '%s\\n' PI_STUDY_SHELL_SAFE",
    cwd: "/redacted/course-root",
    excludeFromContext: false,
  };
  const context = {
    mode: "tui",
    hasUI: true,
    signal: undefined,
    ui: { confirm: () => assert.fail("safe command must not ask for confirmation") },
  };

  try {
    registerPiStudyGuard(fakeApi);
    const userBashHandlers = handlers.get("user_bash");
    assert.equal(userBashHandlers?.length, 2);

    renameSync(tracePath, originalTracePath);
    writeFileSync(tracePath, "", { encoding: "utf8", mode: 0o600 });
    assert.throws(
      () => userBashHandlers![0]!(event, context),
      new RegExp(LIFECYCLE_TRACE_UNAVAILABLE),
    );
    assert.deepEqual(
      await userBashHandlers![1]!(event, context),
      {
        result: {
          output: "PI_STUDY_SHELL_BLOCKED\n",
          exitCode: 126,
          cancelled: false,
          truncated: false,
        },
      },
    );
    assert.equal(readFileSync(originalTracePath, "utf8"), "0001 factory\n");
    assert.equal(readFileSync(tracePath, "utf8"), "");
  } finally {
    restoreEnvironment(previousTrace);
    rmSync(traceRoot, { recursive: true, force: true });
  }
});
