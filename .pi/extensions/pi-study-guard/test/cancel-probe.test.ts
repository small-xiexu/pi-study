import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  CANCEL_PROBE_FLAG,
  CANCEL_PROBE_MARKER_PATH,
  CANCEL_PROBE_WAIT_MESSAGE,
  registerCancelProbe,
  type CancelProbeState,
} from "../cancel-probe.ts";
import type { CooperativeDelayTimer } from "../fixtures/cancellation/cooperative-delay.ts";

type ToolCallHandler = (event: any, ctx: any) => Promise<unknown> | unknown;

class ProbeTimer implements CooperativeDelayTimer {
  private callback: (() => void) | undefined;
  clearCount = 0;

  schedule(callback: () => void): unknown {
    this.callback = callback;
    return Symbol("probe-timer");
  }

  clear(): void {
    this.callback = undefined;
    this.clearCount += 1;
  }

  fire(): void {
    const callback = this.callback;
    assert.ok(callback, "expected an active probe timer");
    callback();
  }
}

function createProbeHarness(enabled: boolean, timer = new ProbeTimer()) {
  let handler: ToolCallHandler | undefined;
  const states: CancelProbeState[] = [];
  const notifications: string[] = [];
  const stderr: string[] = [];
  const api = {
    getFlag(name: string) {
      assert.equal(name, CANCEL_PROBE_FLAG);
      return enabled;
    },
    on(eventName: string, candidate: ToolCallHandler) {
      assert.equal(eventName, "tool_call");
      handler = candidate;
    },
    registerTool() {
      assert.fail("the cancellation probe must not register a custom tool");
    },
  } as unknown as ExtensionAPI;

  registerCancelProbe(api, {
    record: (state) => states.push(state),
    stderr: (message) => stderr.push(message),
    timer,
  });
  assert.ok(handler);

  const context = (signal: AbortSignal | undefined, hasUI = true) => ({
    signal,
    hasUI,
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
  });

  return { context, handler, notifications, states, stderr, timer };
}

const targetReadEvent = {
  type: "tool_call",
  toolName: "read",
  toolCallId: "redacted-test-id",
  input: { path: CANCEL_PROBE_MARKER_PATH },
};

test("the real cancellation probe is inert unless its flag is enabled", async () => {
  const harness = createProbeHarness(false);
  const controller = new AbortController();

  assert.equal(await harness.handler(targetReadEvent, harness.context(controller.signal)), undefined);
  assert.deepEqual(harness.states, []);
  assert.deepEqual(harness.notifications, []);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(harness.timer.clearCount, 0);
});

test("the real cancellation probe blocks every non-target tool call", async () => {
  const harness = createProbeHarness(true);
  const controller = new AbortController();

  const wrongTool = await harness.handler(
    { type: "tool_call", toolName: "bash", toolCallId: "redacted", input: { command: "redacted" } },
    harness.context(controller.signal),
  );
  const wrongPath = await harness.handler(
    { ...targetReadEvent, input: { path: "OTHER.txt" } },
    harness.context(controller.signal),
  );

  assert.deepEqual(wrongTool, {
    block: true,
    reason: "Pi study cancellation probe blocked tool execution",
    terminate: true,
  });
  assert.deepEqual(wrongPath, wrongTool);
  assert.deepEqual(harness.states, ["blocked_tool", "blocked_path"]);
  assert.equal(harness.timer.clearCount, 0);
});

test("the real cancellation probe receives abort and still blocks read execution", { timeout: 1000 }, async () => {
  const harness = createProbeHarness(true);
  const controller = new AbortController();

  const resultPromise = harness.handler(targetReadEvent, harness.context(controller.signal));

  assert.deepEqual(harness.states, ["start"]);
  assert.deepEqual(harness.notifications, [CANCEL_PROBE_WAIT_MESSAGE]);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);

  controller.abort();

  assert.deepEqual(await resultPromise, {
    block: true,
    reason: "Pi study cancellation probe blocked tool execution",
    terminate: true,
  });
  assert.deepEqual(harness.states, ["start", "cancelled"]);
  assert.equal(harness.timer.clearCount, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("the real cancellation probe fails closed when its wait completes", { timeout: 1000 }, async () => {
  const harness = createProbeHarness(true);
  const controller = new AbortController();
  const resultPromise = harness.handler(targetReadEvent, harness.context(controller.signal, false));

  assert.deepEqual(harness.states, ["start"]);
  assert.deepEqual(harness.stderr, [`${CANCEL_PROBE_WAIT_MESSAGE}\n`]);

  harness.timer.fire();

  assert.deepEqual(await resultPromise, {
    block: true,
    reason: "Pi study cancellation probe blocked tool execution",
    terminate: true,
  });
  assert.deepEqual(harness.states, ["start", "completed"]);
  assert.equal(harness.timer.clearCount, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("the real cancellation probe fails closed without an active signal", async () => {
  const harness = createProbeHarness(true);

  assert.deepEqual(await harness.handler(targetReadEvent, harness.context(undefined)), {
    block: true,
    reason: "Pi study cancellation probe blocked tool execution",
    terminate: true,
  });
  assert.deepEqual(harness.states, ["missing_signal"]);
  assert.deepEqual(harness.notifications, []);
  assert.equal(harness.timer.clearCount, 0);
});
