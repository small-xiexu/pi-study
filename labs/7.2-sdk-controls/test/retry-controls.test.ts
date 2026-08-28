import assert from "node:assert/strict";
import test from "node:test";

import type { Context, Model } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  type AgentSessionEvent,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import {
  createEmptyResourceLoader,
  createScriptedRuntime,
  errorStream,
  textStream,
} from "../test-runtime.ts";

const LOOPBACK_MODEL: Model<"openai-completions"> = {
  id: "loopback-retry",
  name: "Loopback Retry",
  api: "openai-completions",
  provider: "pi-study-loopback",
  baseUrl: "http://127.0.0.1/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 1024,
};

const LOOPBACK_CONTEXT: Context = {
  systemPrompt: "Return the fixed marker.",
  messages: [{ role: "user", content: "Return PROVIDER_RETRY_OK", timestamp: Date.now() }],
};

function successfulSse(): string {
  const base = { id: "chatcmpl-control", object: "chat.completion.chunk", created: 1, model: "loopback-retry" };
  return [
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: "PROVIDER_RETRY_OK" }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
}

test("provider retry performs hidden request retries before returning success", async () => {
  let requestCount = 0;
  const fetch: typeof globalThis.fetch = async () => {
    requestCount++;
    if (requestCount < 3) {
      return new Response("temporary unavailable", { status: 503, headers: { "content-type": "text/plain" } });
    }
    return new Response(successfulSse(), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const message = await completeSimple(LOOPBACK_MODEL, LOOPBACK_CONTEXT, {
    apiKey: "pi-study-local-only",
    fetch,
    maxRetries: 2,
    maxRetryDelayMs: 10,
  });
  assert.equal(requestCount, 3);
  assert.equal(message.stopReason, "stop");
  assert.equal(message.content.find((part) => part.type === "text")?.text, "PROVIDER_RETRY_OK");
});

test("agent retry emits visible events and starts a new agent attempt", async () => {
  const { modelRuntime, model, getAttemptCount } = await createScriptedRuntime((selected, _context, attempt) =>
    attempt < 3 ? errorStream(selected, "503 Service Unavailable") : textStream(selected, "AGENT_RETRY_OK"),
  );
  const events: AgentSessionEvent[] = [];
  const { session } = await createAgentSession({
    model,
    modelRuntime,
    tools: [],
    resourceLoader: createEmptyResourceLoader(),
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
    }),
  });
  const unsubscribe = session.subscribe((event) => events.push(event));
  try {
    await session.prompt("Return AGENT_RETRY_OK");
    assert.equal(getAttemptCount(), 3);
    assert.equal(events.filter((event) => event.type === "auto_retry_start").length, 2);
    assert.equal(events.filter((event) => event.type === "agent_start").length, 3);
    const retryEnd = events.find((event) => event.type === "auto_retry_end");
    assert.ok(retryEnd && retryEnd.type === "auto_retry_end" && retryEnd.success);
    assert.equal(events.at(-1)?.type, "agent_settled");
  } finally {
    unsubscribe();
    session.dispose();
  }
});
