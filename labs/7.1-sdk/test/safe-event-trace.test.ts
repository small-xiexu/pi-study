import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import {
  findRealRunContractViolations,
  projectEvent,
  type SafeEventRecord,
} from "../safe-event-trace.ts";

test("projectEvent keeps only bounded event metadata", () => {
  const event = {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "sensitive model text" }],
    },
    assistantMessageEvent: {
      type: "text_delta",
      delta: "sensitive model text",
    },
  } as unknown as AgentSessionEvent;

  const projected = projectEvent(event, 7);

  assert.deepEqual(projected, {
    sequence: 7,
    type: "message_update",
    role: "assistant",
    updateType: "text_delta",
  });
  assert.equal(JSON.stringify(projected).includes("sensitive"), false);
});

test("findRealRunContractViolations accepts the expected two-turn read flow", () => {
  const records: SafeEventRecord[] = [
    { sequence: 1, type: "agent_start" },
    { sequence: 2, type: "turn_start" },
    { sequence: 3, type: "message_start", role: "user" },
    { sequence: 4, type: "message_end", role: "user" },
    { sequence: 5, type: "message_start", role: "assistant" },
    { sequence: 6, type: "message_end", role: "assistant" },
    { sequence: 7, type: "tool_execution_start", toolName: "read" },
    { sequence: 8, type: "tool_execution_end", toolName: "read", isError: false },
    { sequence: 9, type: "message_start", role: "toolResult" },
    { sequence: 10, type: "message_end", role: "toolResult" },
    { sequence: 11, type: "turn_end" },
    { sequence: 12, type: "turn_start" },
    { sequence: 13, type: "message_start", role: "assistant" },
    { sequence: 14, type: "message_end", role: "assistant" },
    { sequence: 15, type: "turn_end" },
    { sequence: 16, type: "agent_end", willRetry: false },
    { sequence: 17, type: "agent_settled" },
  ];

  assert.deepEqual(findRealRunContractViolations(records), []);
});

test("findRealRunContractViolations reports missing or repeated read calls", () => {
  const records: SafeEventRecord[] = [
    { sequence: 1, type: "agent_start" },
    { sequence: 2, type: "turn_start" },
    { sequence: 3, type: "message_start", role: "user" },
    { sequence: 4, type: "message_start", role: "assistant" },
    { sequence: 5, type: "tool_execution_start", toolName: "read" },
    { sequence: 6, type: "tool_execution_start", toolName: "read" },
    { sequence: 7, type: "agent_end" },
    { sequence: 8, type: "agent_settled" },
  ];

  const violations = findRealRunContractViolations(records);

  assert.ok(violations.includes("missing read tool_execution_end"));
  assert.ok(violations.includes("missing ToolResultMessage"));
  assert.ok(violations.includes("expected at least 2 turns, got 1"));
  assert.ok(violations.includes("expected exactly 1 read call, got 2"));
});
