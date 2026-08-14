import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";

import {
  runCooperativeDelay,
  type CooperativeDelayEvent,
  type CooperativeDelayTimer,
} from "../fixtures/cancellation/cooperative-delay.ts";

const PROBE_DELAY_MS = 40;

test("the cooperative delay keeps its default system timer path", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const events: CooperativeDelayEvent[] = [];

  const result = await runCooperativeDelay({
    delayMs: 1,
    signal: controller.signal,
    onEvent: (event) => events.push(event),
  });

  assert.equal(result, "completed");
  assert.deepEqual(events, ["start", "completed"]);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

class ControlledTimer implements CooperativeDelayTimer {
  private nextHandle = 1;
  private readonly active = new Map<unknown, () => void>();
  private readonly captured: Array<() => void> = [];
  private readonly onSchedule?: (callback: () => void) => void;
  private readonly useUndefinedHandle: boolean;
  clearCount = 0;
  forcedFireCount = 0;
  readonly receivedDelays: number[] = [];

  constructor(options: { onSchedule?: (callback: () => void) => void; useUndefinedHandle?: boolean } = {}) {
    this.onSchedule = options.onSchedule;
    this.useUndefinedHandle = options.useUndefinedHandle ?? false;
  }

  schedule(callback: () => void, delayMs: number): unknown {
    const handle = this.useUndefinedHandle ? undefined : this.nextHandle;
    this.nextHandle += 1;
    this.active.set(handle, callback);
    this.captured.push(callback);
    this.receivedDelays.push(delayMs);
    this.onSchedule?.(callback);
    return handle;
  }

  clear(handle: unknown): void {
    if (this.active.delete(handle)) this.clearCount += 1;
  }

  fireActive(): void {
    const entry = this.active.entries().next().value as [unknown, () => void] | undefined;
    assert.ok(entry, "expected one active timer");
    entry[1]();
  }

  forceFireCaptured(): void {
    const callback = this.captured[0];
    assert.ok(callback, "expected one captured timer callback");
    this.forcedFireCount += 1;
    callback();
  }

  get activeCount(): number {
    return this.active.size;
  }

  dispose(): void {
    this.active.clear();
  }
}

test("the cooperative delay completes and cleans up without cancellation", { timeout: 1000 }, async (t) => {
  const controller = new AbortController();
  const timer = new ControlledTimer();
  const events: CooperativeDelayEvent[] = [];
  t.after(() => {
    controller.abort();
    timer.dispose();
  });

  const resultPromise = runCooperativeDelay({
    delayMs: PROBE_DELAY_MS,
    signal: controller.signal,
    onEvent: (event) => events.push(event),
    timer,
  });

  assert.deepEqual(events, ["start"]);
  assert.equal(timer.activeCount, 1);
  assert.deepEqual(timer.receivedDelays, [PROBE_DELAY_MS]);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);

  timer.fireActive();

  assert.equal(await resultPromise, "completed");
  assert.deepEqual(events, ["start", "completed"]);
  assert.equal(timer.activeCount, 0);
  assert.equal(timer.clearCount, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("the cooperative delay cancels, cleans up, and suppresses a late completion", { timeout: 1000 }, async (t) => {
  const controller = new AbortController();
  const timer = new ControlledTimer();
  const events: CooperativeDelayEvent[] = [];
  t.after(() => {
    controller.abort();
    timer.dispose();
  });

  const resultPromise = runCooperativeDelay({
    delayMs: PROBE_DELAY_MS,
    signal: controller.signal,
    onEvent: (event) => events.push(event),
    timer,
  });

  assert.deepEqual(events, ["start"]);
  assert.equal(timer.activeCount, 1);
  assert.deepEqual(timer.receivedDelays, [PROBE_DELAY_MS]);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);

  controller.abort();

  assert.equal(await resultPromise, "cancelled");
  assert.deepEqual(events, ["start", "cancelled"]);
  assert.equal(timer.activeCount, 0);
  assert.equal(timer.clearCount, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);

  timer.forceFireCaptured();
  assert.equal(timer.forcedFireCount, 1);
  assert.deepEqual(events, ["start", "cancelled"]);
});

test("the cooperative delay cleans a timer that completes synchronously during scheduling", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const events: CooperativeDelayEvent[] = [];
  const timer = new ControlledTimer({ onSchedule: (callback) => callback() });

  const result = await runCooperativeDelay({
    delayMs: PROBE_DELAY_MS,
    signal: controller.signal,
    onEvent: (event) => events.push(event),
    timer,
  });

  assert.equal(result, "completed");
  assert.deepEqual(events, ["start", "completed"]);
  assert.equal(timer.activeCount, 0);
  assert.equal(timer.clearCount, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("the cooperative delay cleans a timer when scheduling aborts synchronously", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const events: CooperativeDelayEvent[] = [];
  const timer = new ControlledTimer({ onSchedule: () => controller.abort() });

  const result = await runCooperativeDelay({
    delayMs: PROBE_DELAY_MS,
    signal: controller.signal,
    onEvent: (event) => events.push(event),
    timer,
  });

  assert.equal(result, "cancelled");
  assert.deepEqual(events, ["start", "cancelled"]);
  assert.equal(timer.activeCount, 0);
  assert.equal(timer.clearCount, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("the cooperative delay cleans a valid undefined timer handle", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const events: CooperativeDelayEvent[] = [];
  const timer = new ControlledTimer({ useUndefinedHandle: true });

  const resultPromise = runCooperativeDelay({
    delayMs: PROBE_DELAY_MS,
    signal: controller.signal,
    onEvent: (event) => events.push(event),
    timer,
  });
  timer.fireActive();

  assert.equal(await resultPromise, "completed");
  assert.deepEqual(events, ["start", "completed"]);
  assert.equal(timer.activeCount, 0);
  assert.equal(timer.clearCount, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("the cooperative delay rejects even when timer cleanup throws undefined", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const events: CooperativeDelayEvent[] = [];
  const timer: CooperativeDelayTimer = {
    schedule: () => Symbol("timer"),
    clear: () => {
      throw undefined;
    },
  };

  const resultPromise = runCooperativeDelay({
    delayMs: PROBE_DELAY_MS,
    signal: controller.signal,
    onEvent: (event) => events.push(event),
    timer,
  });
  assert.deepEqual(events, ["start"]);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);

  controller.abort();

  const outcome = await resultPromise.then(
    () => ({ status: "resolved" as const }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  assert.equal(outcome.status, "rejected");
  assert.equal("error" in outcome ? outcome.error : "missing", undefined);
  assert.deepEqual(events, ["start"]);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
