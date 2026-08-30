import assert from "node:assert/strict";
import test from "node:test";

import {
  failureRecord,
  formatAnswer,
  formatConsoleRecord,
  projectSessionEvent,
  sanitizeAnswer,
  type ConsoleRecord,
} from "../safe-output.ts";

test("formats the stable ready contract", () => {
  const record: ConsoleRecord = {
    status: "READY",
    session: "NEW",
    model: "openai/gpt-5.6-sol",
    tools: ["read"],
  };

  assert.equal(
    formatConsoleRecord(record),
    "status=READY session=NEW model=openai/gpt-5.6-sol tools=read",
  );
});

test("projects only the allowed event fields", () => {
  const projected = projectSessionEvent({
    type: "tool_execution_start",
    toolCallId: "call-secret-id",
    toolName: "read",
    args: { path: "/private/project/secret.txt", prompt: "do not expose" },
  });

  assert.deepEqual(projected, { status: "READING", tool: "read" });
  assert.equal(JSON.stringify(projected).includes("secret"), false);
  assert.deepEqual(projectSessionEvent({ type: "tool_execution_end", isError: true }), {
    status: "RUNNING",
  });
  assert.equal(projectSessionEvent({ type: "message_update", assistantMessageEvent: {} }), undefined);
});

test("sanitizes failure diagnostics", () => {
  const record = failureRecord(
    "PROMPT",
    new Error("request failed at https://private.example with token=secret"),
  );
  const formatted = formatConsoleRecord(record);

  assert.equal(formatted, "status=FAILED stage=PROMPT errorKind=Error");
  assert.equal(formatted.includes("private.example"), false);
  assert.equal(formatted.includes("secret"), false);
});

test("removes terminal control sequences from the user-facing answer", () => {
  const answer = [
    "\u001b]8;;https://private.example/path\u0007SAFE_ANSWER\u001b]8;;\u0007",
    "\u001b[31mVISIBLE_TEXT\u001b[0m\u0000",
  ].join("\n");
  const sanitized = sanitizeAnswer(answer);

  assert.equal(sanitized.includes("SAFE_ANSWER"), true);
  assert.equal(sanitized.includes("VISIBLE_TEXT"), true);
  assert.equal(sanitized.includes("private.example"), false);
  assert.equal(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u001b]/u.test(sanitized), false);
});

test("encodes the answer as one line that cannot forge status records", () => {
  const formatted = formatAnswer("first\nanswer=END\nstatus=FAILED stage=RUNTIME");

  assert.equal(formatted.split("\n").length, 1);
  assert.equal(formatted.startsWith("answer="), true);
  assert.equal(formatted.includes("\\nanswer=END\\nstatus=FAILED"), true);
});
