import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface SafeEventRecord {
  sequence: number;
  type: AgentSessionEvent["type"];
  role?: string;
  updateType?: string;
  toolName?: string;
  isError?: boolean;
  willRetry?: boolean;
  reason?: string;
}

export function projectEvent(event: AgentSessionEvent, sequence: number): SafeEventRecord {
  const record: SafeEventRecord = { sequence, type: event.type };

  switch (event.type) {
    case "message_start":
    case "message_end":
      record.role = event.message.role;
      break;
    case "message_update":
      record.role = event.message.role;
      record.updateType = event.assistantMessageEvent.type;
      break;
    case "tool_execution_start":
    case "tool_execution_update":
      record.toolName = event.toolName;
      break;
    case "tool_execution_end":
      record.toolName = event.toolName;
      record.isError = event.isError;
      break;
    case "agent_end":
      record.willRetry = event.willRetry;
      break;
    case "compaction_start":
    case "compaction_end":
      record.reason = event.reason;
      break;
  }

  return record;
}

export class SafeEventRecorder {
  readonly #records: SafeEventRecord[] = [];

  record(event: AgentSessionEvent): SafeEventRecord {
    const projected = projectEvent(event, this.#records.length + 1);
    this.#records.push(projected);
    return projected;
  }

  get records(): readonly SafeEventRecord[] {
    return this.#records;
  }
}

function firstIndex(
  records: readonly SafeEventRecord[],
  predicate: (record: SafeEventRecord) => boolean,
): number {
  return records.findIndex(predicate);
}

export function findRealRunContractViolations(
  records: readonly SafeEventRecord[],
): string[] {
  const violations: string[] = [];
  const checkpoints = [
    ["agent_start", (record: SafeEventRecord) => record.type === "agent_start"],
    [
      "UserMessage",
      (record: SafeEventRecord) => record.type === "message_start" && record.role === "user",
    ],
    [
      "AssistantMessage",
      (record: SafeEventRecord) => record.type === "message_start" && record.role === "assistant",
    ],
    [
      "read tool_execution_start",
      (record: SafeEventRecord) =>
        record.type === "tool_execution_start" && record.toolName === "read",
    ],
    [
      "read tool_execution_end",
      (record: SafeEventRecord) =>
        record.type === "tool_execution_end" && record.toolName === "read",
    ],
    [
      "ToolResultMessage",
      (record: SafeEventRecord) =>
        record.type === "message_start" && record.role === "toolResult",
    ],
    ["agent_end", (record: SafeEventRecord) => record.type === "agent_end"],
    ["agent_settled", (record: SafeEventRecord) => record.type === "agent_settled"],
  ] as const;

  let previousIndex = -1;
  for (const [label, predicate] of checkpoints) {
    const index = firstIndex(records, predicate);
    if (index === -1) {
      violations.push(`missing ${label}`);
      continue;
    }
    if (index <= previousIndex) {
      violations.push(`${label} is out of order`);
    }
    previousIndex = index;
  }

  const turnCount = records.filter((record) => record.type === "turn_start").length;
  if (turnCount < 2) {
    violations.push(`expected at least 2 turns, got ${turnCount}`);
  }

  const readStartCount = records.filter(
    (record) => record.type === "tool_execution_start" && record.toolName === "read",
  ).length;
  if (readStartCount !== 1) {
    violations.push(`expected exactly 1 read call, got ${readStartCount}`);
  }

  const readEnd = records.find(
    (record) => record.type === "tool_execution_end" && record.toolName === "read",
  );
  if (readEnd?.isError === true) {
    violations.push("read tool ended with isError=true");
  }

  return violations;
}
