import assert from "node:assert/strict";
import test from "node:test";

import {
  createShellWidgetController,
  SHELL_WIDGET_KEY,
} from "../shell-widget.ts";

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

test("the Widget renders a bounded state card and replaces the same key", () => {
  const harness = createUiHarness();
  const controller = createShellWidgetController();

  controller.bind({ mode: "tui", hasUI: true, ui: harness.ui });
  controller.render(READY_SNAPSHOT, "ready");
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0]!.key, SHELL_WIDGET_KEY);
  assert.deepEqual(harness.calls[0]!.options, { placement: "aboveEditor" });

  const firstFactory = harness.calls[0]!.content as (tui: unknown, theme: unknown) => {
    render(width: number): string[];
  };
  const firstComponent = firstFactory({}, { fg: (_color: string, text: string) => text });
  assert.match(firstComponent.render(80).join("\n"), /Shell Gate \| enforce/);
  assert.match(firstComponent.render(80).join("\n"), /blocked=0 \| last=none/);

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
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1]!.key, SHELL_WIDGET_KEY);
  const secondFactory = harness.calls[1]!.content as (tui: unknown, theme: unknown) => {
    render(width: number): string[];
  };
  const secondComponent = secondFactory({}, { fg: (_color: string, text: string) => text });
  assert.match(secondComponent.render(80).join("\n"), /blocked=1/);
  assert.match(secondComponent.render(80).join("\n"), /user_bash\/other\/deny\/policy_denied/);
});

test("Widget rendering is skipped without a local UI and clear is idempotent", () => {
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
  assert.equal(tuiHarness.calls.length, 2);
  assert.equal(tuiHarness.calls[1]!.key, SHELL_WIDGET_KEY);
  assert.equal(tuiHarness.calls[1]!.content, undefined);
});

test("unavailable state is visible without exposing command or path data", () => {
  const harness = createUiHarness();
  const controller = createShellWidgetController();
  controller.bind({ mode: "tui", hasUI: true, ui: harness.ui });
  controller.render(READY_SNAPSHOT, "append_failed");

  const factory = harness.calls[0]!.content as (tui: unknown, theme: unknown) => {
    render(width: number): string[];
  };
  const component = factory({}, { fg: (_color: string, text: string) => text });
  const rendered = component.render(80).join("\n");
  assert.match(rendered, /Shell Gate \| unavailable/);
  assert.match(rendered, /status=append_failed/);
  assert.equal(rendered.includes("PI_STUDY_SHELL_EXECUTED"), false);
  assert.equal(rendered.includes("/redacted"), false);
});

test("a failed render still leaves one best-effort cleanup attempt", () => {
  const calls: unknown[] = [];
  const controller = createShellWidgetController();
  controller.bind({
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget(_key: string, content: unknown) {
        calls.push(content);
        if (content !== undefined) throw new Error("redacted partial render failure");
      },
    },
  });

  assert.doesNotThrow(() => controller.render(READY_SNAPSHOT, "ready"));
  controller.clear();
  controller.clear();
  assert.equal(calls.length, 2);
  assert.equal(calls[1], undefined);
});
