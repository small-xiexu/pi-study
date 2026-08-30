export type TaskStatus =
  | "STARTING"
  | "READY"
  | "RUNNING"
  | "READING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "BUSY";

export type FailureStage = "STARTUP" | "PROMPT" | "RUNTIME" | "SHUTDOWN";

export type ConsoleRecord =
  | { status: "STARTING" }
  | {
      status: "READY";
      session: "NEW" | "RESUMED";
      model: string;
      tools: readonly string[];
    }
  | { status: "RUNNING" }
  | { status: "READING"; tool: "read" }
  | { status: "COMPLETED"; saved: boolean }
  | { status: "FAILED"; stage: FailureStage; errorKind: string }
  | { status: "CANCELLED" }
  | { status: "BUSY" };

const FIXED_ERROR_KINDS = new Set([
  "Error",
  "UnknownError",
  "ToolContractViolation",
  "ResourceContractViolation",
  "ModelContractViolation",
  "SessionDirectoryContractViolation",
  "SessionDirectoryPermissionError",
  "SessionDirectoryBusy",
  "SessionFileContractViolation",
  "InputTooLong",
  "RuntimeNotInitialized",
  "RuntimeClosed",
  "ConcurrentRun",
  "PromptFailure",
  "SettlementMissing",
  "AssistantMissing",
  "AssistantNotNormal",
  "EmptyAssistantAnswer",
  "PersistenceUnconfirmed",
  "CancellationFailure",
  "BrokenPipe",
  "ShutdownFailure",
  "ShutdownTimeout",
  "SmokeTimeout",
  "SmokeContractViolation",
]);

export function normalizeErrorKind(errorKind: string): string {
  return FIXED_ERROR_KINDS.has(errorKind) ? errorKind : "UnknownError";
}

export function fixedErrorKind(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  return normalizeErrorKind(error.name);
}

export function failureRecord(stage: FailureStage, error: unknown): ConsoleRecord {
  return { status: "FAILED", stage, errorKind: fixedErrorKind(error) };
}

export function formatConsoleRecord(record: ConsoleRecord): string {
  switch (record.status) {
    case "READY":
      return [
        "status=READY",
        `session=${record.session}`,
        `model=${record.model}`,
        `tools=${record.tools.join(",")}`,
      ].join(" ");
    case "READING":
      return `status=READING tool=${record.tool}`;
    case "COMPLETED":
      return `status=COMPLETED saved=${String(record.saved)}`;
    case "FAILED":
      return `status=FAILED stage=${record.stage} errorKind=${normalizeErrorKind(record.errorKind)}`;
    default:
      return `status=${record.status}`;
  }
}

interface ProjectableSessionEvent {
  readonly [key: string]: unknown;
  readonly type?: unknown;
  readonly toolName?: unknown;
}

export function projectSessionEvent(event: ProjectableSessionEvent): ConsoleRecord | undefined {
  if (event.type === "tool_execution_start" && event.toolName === "read") {
    return { status: "READING", tool: "read" };
  }
  if (event.type === "tool_execution_end") {
    return { status: "RUNNING" };
  }
  return undefined;
}

function isCsiFinal(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

function skipCsi(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    if (isCsiFinal(text.charCodeAt(index))) return index + 1;
    index += 1;
  }
  return text.length;
}

function skipStringControl(text: string, start: number, allowBell: boolean): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (allowBell && code === 0x07) return index + 1;
    if (code === 0x1b && text.charCodeAt(index + 1) === 0x5c) return index + 2;
    index += 1;
  }
  return text.length;
}

/** Remove terminal control sequences while preserving ordinary text, tabs, and line feeds. */
export function sanitizeAnswer(text: string): string {
  let result = "";
  let index = 0;

  while (index < text.length) {
    const code = text.charCodeAt(index);

    if (code === 0x1b) {
      const next = text.charCodeAt(index + 1);
      if (next === 0x5b) {
        index = skipCsi(text, index + 2);
      } else if (next === 0x5d) {
        index = skipStringControl(text, index + 2, true);
      } else if (next === 0x50 || next === 0x58 || next === 0x5e || next === 0x5f) {
        index = skipStringControl(text, index + 2, false);
      } else {
        index = Math.min(index + 2, text.length);
      }
      continue;
    }

    if (code === 0x9b) {
      index = skipCsi(text, index + 1);
      continue;
    }

    if (code === 0x9d) {
      index = skipStringControl(text, index + 1, true);
      continue;
    }

    if (code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
      index = skipStringControl(text, index + 1, false);
      continue;
    }

    const isPreservedWhitespace = code === 0x09 || code === 0x0a;
    const isC0 = code <= 0x1f || code === 0x7f;
    const isC1 = code >= 0x80 && code <= 0x9f;
    if ((isC0 && !isPreservedWhitespace) || isC1) {
      index += 1;
      continue;
    }

    result += text[index];
    index += 1;
  }

  return result;
}

/** Encode the sanitized answer as one physical line so it cannot forge status records. */
export function formatAnswer(text: string): string {
  const encoded = JSON.stringify(sanitizeAnswer(text))
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `answer=${encoded}`;
}
