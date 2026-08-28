import assert from "node:assert/strict";
import test from "node:test";

import { createAgentSession, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { createEmptyResourceLoader, createScriptedRuntime, textStream } from "../test-runtime.ts";

const customTool = {
  name: "control_tool",
  label: "Control Tool",
  description: "Deterministic control-plane test tool",
  parameters: Type.Object({}, { additionalProperties: false }),
  execute: async () => ({ content: [{ type: "text" as const, text: "CONTROL_OK" }], details: {} }),
};

async function activeTools(options: {
  tools?: string[];
  excludeTools?: string[];
  noTools?: "all" | "builtin";
}): Promise<string[]> {
  const { modelRuntime, model } = await createScriptedRuntime((selected) => textStream(selected, "OK"));
  const { session } = await createAgentSession({
    ...options,
    model,
    modelRuntime,
    resourceLoader: createEmptyResourceLoader(),
    customTools: [customTool],
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
  });
  try {
    return session.getActiveToolNames().sort();
  } finally {
    session.dispose();
  }
}

test("tool controls compose allowlist, denylist, and noTools modes", async () => {
  assert.deepEqual(await activeTools({}), ["bash", "control_tool", "edit", "read", "write"]);
  assert.deepEqual(await activeTools({ noTools: "builtin" }), ["control_tool"]);
  assert.deepEqual(await activeTools({ noTools: "all" }), []);
  assert.deepEqual(await activeTools({ noTools: "all", tools: ["read"] }), ["read"]);
  assert.deepEqual(
    await activeTools({ tools: ["read", "bash", "control_tool"], excludeTools: ["bash", "control_tool"] }),
    ["read"],
  );
});
