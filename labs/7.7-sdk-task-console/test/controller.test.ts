import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_INPUT_BYTES,
  TaskConsoleController,
  type ReadyInfo,
  type TaskConsoleRuntimePort,
  type TaskRunResult,
} from "../task-console-controller.ts";
import type { ConsoleRecord } from "../safe-output.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeRuntime implements TaskConsoleRuntimePort {
  readonly readyInfo: ReadyInfo;
  readonly runs: string[] = [];
  readonly run = deferred<TaskRunResult>();
  cancelCount = 0;
  closeCount = 0;
  unsubscribeCount = 0;
  private listener?: (record: ConsoleRecord) => void;

  constructor(tools: string[] = ["read"]) {
    this.readyInfo = {
      session: "NEW",
      model: "openai/gpt-5.6-sol",
      tools,
    };
  }

  async initialize(): Promise<ReadyInfo> {
    return this.readyInfo;
  }

  subscribe(listener: (record: ConsoleRecord) => void): () => void {
    this.listener = listener;
    return () => {
      this.unsubscribeCount += 1;
      this.listener = undefined;
    };
  }

  async runTask(text: string): Promise<TaskRunResult> {
    this.runs.push(text);
    return this.run.promise;
  }

  emit(record: ConsoleRecord): void {
    this.listener?.(record);
  }

  async cancel(): Promise<boolean> {
    this.cancelCount += 1;
    return true;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

test("runs one task, rejects a second task as busy, and returns to ready", async () => {
  const runtime = new FakeRuntime();
  const records: ConsoleRecord[] = [];
  const answers: string[] = [];
  const outputSequence: string[] = [];
  const controller = new TaskConsoleController(runtime, {
    onRecord: (record) => {
      records.push(record);
      outputSequence.push(`status=${record.status}`);
    },
    onAnswer: (answer) => {
      answers.push(answer);
      outputSequence.push(`answer=${answer}`);
    },
  });

  await controller.start();
  assert.deepEqual(records.slice(0, 2), [
    { status: "STARTING" },
    {
      status: "READY",
      session: "NEW",
      model: "openai/gpt-5.6-sol",
      tools: ["read"],
    },
  ]);

  assert.equal(await controller.handleLine("inspect the fixture"), "STARTED");
  assert.equal(await controller.handleLine("x".repeat(MAX_INPUT_BYTES + 1)), "BUSY");
  assert.equal(await controller.handleLine("second task"), "BUSY");
  assert.deepEqual(runtime.runs, ["inspect the fixture"]);
  assert.deepEqual(records.at(-1), { status: "BUSY" });

  runtime.emit({ status: "READING", tool: "read" });
  runtime.run.resolve({ outcome: "completed", answer: "done", saved: true });
  await controller.waitForIdle();

  assert.deepEqual(answers, ["done"]);
  assert.deepEqual(records.slice(-3), [
    { status: "READING", tool: "read" },
    { status: "COMPLETED", saved: true },
    {
      status: "READY",
      session: "NEW",
      model: "openai/gpt-5.6-sol",
      tools: ["read"],
    },
  ]);
  assert.deepEqual(outputSequence.slice(-3), [
    "status=COMPLETED",
    "answer=done",
    "status=READY",
  ]);
});

test("cancels an active task before closing", async () => {
  const runtime = new FakeRuntime();
  const records: ConsoleRecord[] = [];
  const controller = new TaskConsoleController(runtime, {
    onRecord: (record) => records.push(record),
    onAnswer: () => {},
  });

  await controller.start();
  await controller.handleLine("long task");
  assert.equal(await controller.handleLine("/cancel"), "CANCEL_REQUESTED");
  assert.equal(runtime.cancelCount, 1);

  runtime.run.resolve({ outcome: "cancelled", saved: false });
  await controller.waitForIdle();
  assert.deepEqual(records.slice(-2), [
    { status: "CANCELLED" },
    {
      status: "READY",
      session: "NEW",
      model: "openai/gpt-5.6-sol",
      tools: ["read"],
    },
  ]);

  assert.equal(await controller.handleLine("/quit"), "QUIT");
  assert.equal(runtime.unsubscribeCount, 1);
  assert.equal(runtime.closeCount, 1);
});

test("quit waits for the active task promise before releasing runtime resources", async () => {
  const runtime = new FakeRuntime();
  const controller = new TaskConsoleController(runtime, {
    onRecord: () => {},
    onAnswer: () => {},
  });

  await controller.start();
  await controller.handleLine("task still in preflight");

  let quitSettled = false;
  const quitPromise = controller.handleLine("/quit").then((result) => {
    quitSettled = true;
    return result;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(runtime.cancelCount, 1);
  assert.equal(runtime.closeCount, 0);
  assert.equal(runtime.unsubscribeCount, 0);
  assert.equal(quitSettled, false);

  runtime.run.resolve({ outcome: "cancelled", saved: false });
  assert.equal(await quitPromise, "QUIT");
  assert.equal(runtime.closeCount, 1);
  assert.equal(runtime.unsubscribeCount, 1);
});

test("fails closed when the active tool set is broader than read", async () => {
  const runtime = new FakeRuntime(["read", "bash"]);
  const records: ConsoleRecord[] = [];
  const controller = new TaskConsoleController(runtime, {
    onRecord: (record) => records.push(record),
    onAnswer: () => {},
  });

  await assert.rejects(controller.start(), /active tools/i);
  assert.deepEqual(records.at(-1), {
    status: "FAILED",
    stage: "STARTUP",
    errorKind: "ToolContractViolation",
  });
});

test("ignores blank input, trims tasks, and allows the same text after ready", async () => {
  const runtime = new FakeRuntime();
  const records: ConsoleRecord[] = [];
  const controller = new TaskConsoleController(runtime, {
    onRecord: (record) => records.push(record),
    onAnswer: () => {},
  });

  await controller.start();
  const readyRecordCount = records.length;
  assert.equal(await controller.handleLine(" \t "), "IGNORED");
  assert.equal(records.length, readyRecordCount);
  assert.deepEqual(runtime.runs, []);

  assert.equal(await controller.handleLine("  repeated task  "), "STARTED");
  runtime.run.resolve({ outcome: "completed", answer: "done", saved: true });
  await controller.waitForIdle();
  assert.equal(await controller.handleLine("repeated task"), "STARTED");
  await controller.waitForIdle();

  assert.deepEqual(runtime.runs, ["repeated task", "repeated task"]);
});

test("rejects input above 8192 UTF-8 bytes before trimming and then recovers", async () => {
  const runtime = new FakeRuntime();
  const records: ConsoleRecord[] = [];
  const controller = new TaskConsoleController(runtime, {
    onRecord: (record) => records.push(record),
    onAnswer: () => {},
  });

  await controller.start();
  const accepted = "a".repeat(MAX_INPUT_BYTES);
  assert.equal(Buffer.byteLength(accepted, "utf8"), 8192);
  assert.equal(await controller.handleLine(accepted), "STARTED");
  runtime.run.resolve({ outcome: "completed", answer: "done", saved: true });
  await controller.waitForIdle();

  const oversizedUnicode = "界".repeat(Math.floor(MAX_INPUT_BYTES / 3) + 1);
  assert.equal(oversizedUnicode.length < MAX_INPUT_BYTES, true);
  assert.equal(Buffer.byteLength(oversizedUnicode, "utf8") > MAX_INPUT_BYTES, true);
  assert.equal(await controller.handleLine(oversizedUnicode), "INPUT_REJECTED");
  assert.deepEqual(records.slice(-2), [
    { status: "FAILED", stage: "RUNTIME", errorKind: "InputTooLong" },
    {
      status: "READY",
      session: "NEW",
      model: "openai/gpt-5.6-sol",
      tools: ["read"],
    },
  ]);
  assert.deepEqual(runtime.runs, [accepted]);

  assert.equal(await controller.handleLine(" next task "), "STARTED");
  await controller.waitForIdle();
  assert.deepEqual(runtime.runs, [accepted, "next task"]);
});

test("keeps the startup failure authoritative and also reports cleanup failure", async () => {
  const records: ConsoleRecord[] = [];
  const runtime: TaskConsoleRuntimePort = {
    async initialize(): Promise<ReadyInfo> {
      throw new Error("private startup detail");
    },
    subscribe: () => () => {},
    async runTask(): Promise<TaskRunResult> {
      throw new Error("must not run");
    },
    async cancel(): Promise<boolean> {
      return false;
    },
    async close(): Promise<void> {
      throw new Error("private cleanup detail");
    },
  };
  const controller = new TaskConsoleController(runtime, {
    onRecord: (record) => records.push(record),
    onAnswer: () => {},
  });

  await assert.rejects(controller.start());

  assert.deepEqual(records, [
    { status: "STARTING" },
    { status: "FAILED", stage: "STARTUP", errorKind: "Error" },
    { status: "FAILED", stage: "SHUTDOWN", errorKind: "ShutdownFailure" },
  ]);
});
