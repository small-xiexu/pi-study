import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";

function user(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5.6-sol",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

test("persistent sessions reopen the active branch with compaction-aware context", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pi-study-72-session-"));
  try {
    const manager = SessionManager.create(temporaryRoot, temporaryRoot);
    manager.appendModelChange("openai", "gpt-5.6-sol");
    manager.appendThinkingLevelChange("off");
    manager.appendMessage(user("OLD_MARKER"));
    manager.appendMessage(assistant("OLD_REPLY"));
    const firstKeptEntryId = manager.appendMessage(user("RECENT_MARKER"));
    manager.appendMessage(assistant("RECENT_REPLY"));
    manager.appendCompaction("SUMMARY_MARKER", firstKeptEntryId, 200);
    manager.appendMessage(user("AFTER_COMPACTION"));

    assert.ok(manager.getSessionFile());
    const reopened = SessionManager.open(manager.getSessionFile()!);
    const context = reopened.buildSessionContext();
    const serialized = JSON.stringify(context.messages);
    assert.equal(context.model?.provider, "openai");
    assert.equal(context.model?.modelId, "gpt-5.6-sol");
    assert.equal(context.thinkingLevel, "off");
    assert.ok(serialized.includes("SUMMARY_MARKER"));
    assert.ok(serialized.includes("RECENT_MARKER"));
    assert.ok(serialized.includes("AFTER_COMPACTION"));
    assert.equal(serialized.includes("OLD_MARKER"), false);

    const continued = SessionManager.continueRecent(temporaryRoot, temporaryRoot);
    assert.equal(continued.getSessionFile(), manager.getSessionFile());
    assert.equal(continued.getLeafId(), manager.getLeafId());
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
