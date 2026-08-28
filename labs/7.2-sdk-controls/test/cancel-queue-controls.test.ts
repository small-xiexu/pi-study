import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentSession,
  type AgentSessionEvent,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  contextText,
  createEmptyResourceLoader,
  createScriptedRuntime,
  deferred,
  textStream,
  toolCallStream,
} from "../test-runtime.ts";

test("abort propagates to a cooperative tool and settles without late completion", async () => {
  const started = deferred<void>();
  let aborted = false;
  let completed = false;
  const delayTool = {
    name: "delay_until_abort",
    label: "Delay Until Abort",
    description: "Wait until the current run is aborted",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id: string, _params: {}, signal?: AbortSignal) {
      started.resolve();
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          aborted = true;
          reject(new Error("Operation aborted"));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
      completed = true;
      return { content: [{ type: "text" as const, text: "LATE_COMPLETION" }], details: {} };
    },
  };
  const { modelRuntime, model } = await createScriptedRuntime((selected, _context, attempt) =>
    attempt === 1 ? toolCallStream(selected, delayTool.name) : textStream(selected, "UNEXPECTED"),
  );
  const events: AgentSessionEvent["type"][] = [];
  const { session } = await createAgentSession({
    model,
    modelRuntime,
    tools: [delayTool.name],
    customTools: [delayTool],
    resourceLoader: createEmptyResourceLoader(),
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
  });
  const unsubscribe = session.subscribe((event) => events.push(event.type));
  try {
    const promptPromise = session.prompt("Call delay_until_abort exactly once.");
    await started.promise;
    await session.abort();
    await promptPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(aborted, true);
    assert.equal(completed, false);
    assert.ok(events.includes("tool_execution_end"));
    assert.ok(events.includes("agent_settled"));
  } finally {
    unsubscribe();
    session.dispose();
  }
});

test("steering is delivered before follow-up at their distinct drain points", async () => {
  const started = deferred<void>();
  const release = deferred<void>();
  const gateTool = {
    name: "release_gate",
    label: "Release Gate",
    description: "Wait for the test to release the current tool batch",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      started.resolve();
      await release.promise;
      return { content: [{ type: "text" as const, text: "GATE_RELEASED" }], details: {} };
    },
  };
  const seenContexts: string[] = [];
  const { modelRuntime, model, getAttemptCount } = await createScriptedRuntime((selected, context, attempt) => {
    const text = contextText(context);
    seenContexts.push(text);
    if (attempt === 1) return toolCallStream(selected, gateTool.name);
    if (text.includes("FOLLOW_MARKER")) return textStream(selected, "FOLLOW_ACK");
    if (text.includes("STEER_MARKER")) return textStream(selected, "STEER_ACK");
    return textStream(selected, "UNEXPECTED_CONTEXT");
  });
  const deliveredUserMessages: string[] = [];
  const queueSizes: number[] = [];
  const { session } = await createAgentSession({
    model,
    modelRuntime,
    tools: [gateTool.name],
    customTools: [gateTool],
    resourceLoader: createEmptyResourceLoader(),
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({
      retry: { enabled: false },
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    }),
  });
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_start" && event.message.role === "user") {
      const content = typeof event.message.content === "string"
        ? event.message.content
        : event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
      deliveredUserMessages.push(content);
    }
    if (event.type === "queue_update") {
      queueSizes.push(event.steering.length + event.followUp.length);
    }
  });
  try {
    const promptPromise = session.prompt("Call release_gate exactly once.");
    await started.promise;
    await session.steer("STEER_MARKER");
    await session.followUp("FOLLOW_MARKER");
    release.resolve();
    await promptPromise;
    assert.equal(getAttemptCount(), 3);
    assert.deepEqual(deliveredUserMessages.slice(1), ["STEER_MARKER", "FOLLOW_MARKER"]);
    assert.ok(seenContexts[1]?.includes("STEER_MARKER"));
    assert.equal(seenContexts[1]?.includes("FOLLOW_MARKER"), false);
    assert.ok(seenContexts[2]?.includes("FOLLOW_MARKER"));
    assert.ok(queueSizes.some((size) => size === 2));
    assert.equal(session.pendingMessageCount, 0);
  } finally {
    unsubscribe();
    session.dispose();
  }
});
