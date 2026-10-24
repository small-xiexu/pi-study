import assert from "node:assert/strict";
import test from "node:test";

import { createShellWidgetController } from "../shell-widget.ts";

const READY_SNAPSHOT = {
  version: 1 as const,
  mode: "enforce" as const,
  blockedCount: 0,
  lastDecision: null,
};

function createUiHarness() {
  const calls: Array<{ key: string; content: unknown; options: unknown }> = [];
  return {
    calls,
    ui: {
      setWidget(key: string, content: unknown, options?: unknown) {
        calls.push({ key, content, options });
      },
    },
  };
}

test("the shell status widget stays hidden while gate state changes", () => {
  const harness = createUiHarness();
  const controller = createShellWidgetController();

  controller.bind({ mode: "tui", hasUI: true, ui: harness.ui });
  controller.render(READY_SNAPSHOT, "ready");
  controller.render(
    {
      ...READY_SNAPSHOT,
      blockedCount: 1,
      lastDecision: {
        entry: "user_bash",
        rule: "other",
        decision: "deny",
        reason: "policy_denied",
      },
    },
    "ready",
  );

  assert.equal(harness.calls.length, 0);
});

test("hidden widget cleanup is safe and does not mount a status card", () => {
  const noUiHarness = createUiHarness();
  const noUiController = createShellWidgetController();
  noUiController.bind({ mode: "print", hasUI: false, ui: noUiHarness.ui });
  noUiController.render(READY_SNAPSHOT, "ready");
  noUiController.clear();
  assert.equal(noUiHarness.calls.length, 0);

  const tuiHarness = createUiHarness();
  const tuiController = createShellWidgetController();
  tuiController.bind({ mode: "tui", hasUI: true, ui: tuiHarness.ui });
  tuiController.render(READY_SNAPSHOT, "ready");
  tuiController.clear();
  tuiController.clear();
  assert.equal(tuiHarness.calls.length, 0);
});

test("hidden status rendering does not expose command or path data", () => {
  const harness = createUiHarness();
  const controller = createShellWidgetController();
  controller.bind({ mode: "tui", hasUI: true, ui: harness.ui });
  controller.render(READY_SNAPSHOT, "append_failed");

  assert.equal(harness.calls.length, 0);
});

test("hidden status rendering tolerates UI failures", () => {
  const controller = createShellWidgetController();
  controller.bind({
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget() {
        throw new Error("redacted partial render failure");
      },
    },
  });

  assert.doesNotThrow(() => controller.render(READY_SNAPSHOT, "ready"));
  assert.doesNotThrow(() => controller.clear());
});
