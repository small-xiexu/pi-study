import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 默认导出的工厂函数负责产生实际注册行为；GUARD_FLAG 则作为保持不变的期望名称。
import registerPiStudyGuard, { GUARD_FLAG } from "../index.ts";
import { CANCEL_PROBE_FLAG } from "../cancel-probe.ts";
import { INSPECT_TOOL_NAME } from "../inspect-tool.ts";
import {
  LIFECYCLE_TRACE_COMMAND,
  LIFECYCLE_TRACE_ENV,
  LIFECYCLE_TRACE_FILE_NAME,
  registerLifecycleTrace,
} from "../lifecycle-trace.ts";

type FlagOptions = Parameters<ExtensionAPI["registerFlag"]>[1];
type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];
type EventHandler = (event: any, ctx: any) => unknown;
type CommandHandler = (args: string, ctx: any) => unknown;

function restoreEnvironment(previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[LIFECYCLE_TRACE_ENV];
  } else {
    process.env[LIFECYCLE_TRACE_ENV] = previousValue;
  }
}

test("the factory registers the expected marker flag", () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  delete process.env[LIFECYCLE_TRACE_ENV];
  const registrations: Array<{ name: string; options: FlagOptions }> = [];
  const eventNames: string[] = [];
  const toolNames: string[] = [];
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
  assert.deepEqual(eventNames, ["tool_call"]);
  assert.deepEqual(toolNames, [INSPECT_TOOL_NAME]);
});

test("the factory keeps the cancellation gate fail-closed without lifecycle tracing", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  delete process.env[LIFECYCLE_TRACE_ENV];
  let toolCallHandler: EventHandler | undefined;

  const fakeApi = {
    registerFlag() {},
    getFlag(name: string) {
      assert.equal(name, CANCEL_PROBE_FLAG);
      return true;
    },
    on(eventName: string, handler: EventHandler) {
      assert.equal(eventName, "tool_call");
      toolCallHandler = handler;
    },
    registerTool(tool: RegisteredTool) {
      assert.equal(tool.name, INSPECT_TOOL_NAME);
    },
  } as unknown as ExtensionAPI;

  try {
    registerPiStudyGuard(fakeApi);
    assert.ok(toolCallHandler);
    assert.deepEqual(
      await toolCallHandler(
        {
          type: "tool_call",
          toolName: "read",
          toolCallId: "redacted-test-id",
          input: { path: "PI_STUDY_CANCEL_MARKER.txt" },
        },
        { signal: undefined },
      ),
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

test("the trace mode records only the lifecycle allowlist", async () => {
  const previousTrace = process.env[LIFECYCLE_TRACE_ENV];
  const traceRoot = mkdtempSync(join(tmpdir(), "pi-study-lifecycle-test."));
  const tracePath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
  const handlers = new Map<string, EventHandler[]>();
  let commandHandler: CommandHandler | undefined;
  const notifications: Array<{ message: string; level: string }> = [];

  const fakeApi = {
    registerFlag() {},
    getFlag() {
      return false;
    },
    registerCommand(name: string, options: { handler: CommandHandler }) {
      assert.equal(name, LIFECYCLE_TRACE_COMMAND);
      commandHandler = options.handler;
    },
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
    registerTool(tool: RegisteredTool) {
      assert.equal(tool.name, INSPECT_TOOL_NAME);
    },
  } as unknown as ExtensionAPI;

  const invoke = async (eventName: string, event: Record<string, unknown>): Promise<void> => {
    const registered = handlers.get(eventName);
    assert.ok(registered, `missing ${eventName} handler`);
    for (const handler of registered) {
      await handler(event, {});
    }
  };

  process.env[LIFECYCLE_TRACE_ENV] = tracePath;
  try {
    registerPiStudyGuard(fakeApi);
    assert.ok(commandHandler);

    await invoke("session_start", { type: "session_start", reason: "startup" });
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
      "0005 model_select source=cycle",
      "0006 input source=interactive",
      "0007 before_agent_start",
      "0008 agent_start",
      "0009 message_start role=user",
      "0010 turn_start",
      "0011 tool_call tool=read",
      "0012 tool_result tool=read",
      "0013 message_end role=assistant",
      "0014 turn_end",
      "0015 agent_end",
      "0016 agent_settled",
      "0017 session_shutdown reason=quit",
    ]);

    assert.deepEqual(notifications, [
      {
        message:
          "PI_STUDY_CONTEXT name=pi-study-trace mode=tui hasUI=true cwdMatchesProcess=true trusted=false sessionFile=none model=none signal=none route=ui",
        level: "info",
      },
    ]);

    const trace = readFileSync(tracePath, "utf8");
    for (const secret of ["SECRET_ARGUMENT", "SECRET_COMMAND", "SECRET_PROMPT", "/SECRET/PATH", "SECRET_RESULT", "SECRET_MESSAGE"]) {
      assert.equal(trace.includes(secret), false, `trace leaked ${secret}`);
    }
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
      () => registerPiStudyGuard({ registerFlag() {} } as unknown as ExtensionAPI),
      new RegExp(`${LIFECYCLE_TRACE_FILE_NAME} inside the OS temp directory`),
    );

    process.env[LIFECYCLE_TRACE_ENV] = join(process.cwd(), LIFECYCLE_TRACE_FILE_NAME);
    assert.throws(
      () => registerPiStudyGuard({ registerFlag() {} } as unknown as ExtensionAPI),
      new RegExp(`${LIFECYCLE_TRACE_FILE_NAME} inside the OS temp directory`),
    );

    const symlinkTarget = join(traceRoot, "target.log");
    const symlinkPath = join(traceRoot, LIFECYCLE_TRACE_FILE_NAME);
    writeFileSync(symlinkTarget, "", "utf8");
    symlinkSync(symlinkTarget, symlinkPath);
    process.env[LIFECYCLE_TRACE_ENV] = symlinkPath;
    assert.throws(
      () => registerPiStudyGuard({ registerFlag() {} } as unknown as ExtensionAPI),
      /must not point to a symbolic link/,
    );
  } finally {
    restoreEnvironment(previousTrace);
    rmSync(traceRoot, { recursive: true, force: true });
  }
});
