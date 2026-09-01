import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  createAgentSession,
  CURRENT_SESSION_VERSION,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { type ReadyInfo, type TaskConsoleRuntimePort, type TaskRunResult } from "./task-console-controller.ts";
import {
  projectSessionEvent,
  sanitizeAnswer,
  type ConsoleRecord,
} from "./safe-output.ts";

const PROVIDER_ID = "openai";
const MODEL_ID = "gpt-5.6-sol";
const MODEL_NAME = `${PROVIDER_ID}/${MODEL_ID}`;
const SESSION_DIRECTORY_ENV = "PI_STUDY_77_SESSION_DIR";
export const SESSION_OWNER_MARKER_FILE = ".pi-study-7.7-sdk-task-console-owner";
export const SESSION_OWNER_MARKER_CONTENT = "pi-study-7.7-sdk-task-console:v1\n";
export const SESSION_LEASE_FILE = ".pi-study-7.7-sdk-task-console-lease";
export const TASK_READ_RELATIVE_PATH = path.join(
  "labs",
  "7.7-sdk-task-console",
  "fixture.txt",
);
export const TASK_READ_PATH_BLOCK_REASON = "Read request blocked by task path policy";

const SESSION_LEASE_VERSION = 1;
const MAX_SESSION_LEASE_BYTES = 512;

interface ErrorWithCode extends NodeJS.ErrnoException {
  code?: string;
}

function fixedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

class SdkContextInitializationFailure extends Error {
  override readonly name = "SdkContextInitializationFailure";
  readonly primaryError: unknown;

  constructor(primaryError: unknown) {
    super("Task SDK context initialization cleanup failed");
    this.primaryError = primaryError;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function canonicalizeProspectivePath(input: string): Promise<string> {
  let cursor = path.resolve(input);
  const missingSegments: string[] = [];

  while (true) {
    try {
      const existing = await realpath(cursor);
      return path.resolve(existing, ...missingSegments);
    } catch (error) {
      if ((error as ErrorWithCode).code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

export interface ResolveSessionDirectoryOptions {
  env: Readonly<Record<string, string | undefined>>;
  homeDirectory: string;
}

export function resolveSessionDirectory(options: ResolveSessionDirectoryOptions): string {
  const override = options.env[SESSION_DIRECTORY_ENV]?.trim();
  if (override) return path.resolve(override);
  return path.join(
    options.homeDirectory,
    ".pi",
    "agent",
    "sessions",
    "pi-study-7.7-sdk-task-console",
  );
}

export interface PrivateSessionDirectoryOptions {
  repositoryRoot?: string;
}

async function createSessionDirectory(directory: string): Promise<boolean> {
  await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  try {
    await mkdir(directory, { mode: 0o700 });
    return true;
  } catch (error) {
    if ((error as ErrorWithCode).code === "EEXIST") return false;
    throw error;
  }
}

async function validateOwnedSessionDirectory(directory: string): Promise<void> {
  const names = await readdir(directory);
  if (!names.includes(SESSION_OWNER_MARKER_FILE)) {
    throw fixedError(
      "SessionDirectoryContractViolation",
      "Session directory is not owned by this task console",
    );
  }

  for (const name of names) {
    const entry = await lstat(path.join(directory, name));
    if (entry.isSymbolicLink()) {
      throw fixedError(
        "SessionDirectoryContractViolation",
        "Session directory contains a symbolic link",
      );
    }
    if (entry.isFile() && entry.nlink !== 1) {
      throw fixedError(
        "SessionDirectoryContractViolation",
        "Session directory contains a hard linked session file",
      );
    }

    if (name === SESSION_OWNER_MARKER_FILE) {
      if (
        !entry.isFile() ||
        entry.size !== Buffer.byteLength(SESSION_OWNER_MARKER_CONTENT) ||
        (await readFile(path.join(directory, name), "utf8")) !==
          SESSION_OWNER_MARKER_CONTENT
      ) {
        throw fixedError(
          "SessionDirectoryContractViolation",
          "Session directory ownership marker is invalid",
        );
      }
      continue;
    }

    if (name === SESSION_LEASE_FILE) {
      if (!entry.isFile()) {
        throw fixedError(
          "SessionDirectoryContractViolation",
          "Session directory lease is not a regular file",
        );
      }
      continue;
    }

    if (!name.endsWith(".jsonl") || !entry.isFile()) {
      throw fixedError(
        "SessionDirectoryContractViolation",
        "Session directory contains an unsupported session file",
      );
    }
  }
}

function sessionFileViolation(): Error {
  return fixedError(
    "SessionFileContractViolation",
    "Session file does not match the task console contract",
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isMessageTimestamp(value: unknown): value is number {
  return isNonNegativeNumber(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isTextContent(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    value.type === "text" &&
    typeof value.text === "string" &&
    isOptionalString(value.textSignature)
  );
}

function isImageContent(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    value.type === "image" &&
    typeof value.data === "string" &&
    isNonEmptyString(value.mimeType)
  );
}

function isThinkingContent(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    value.type === "thinking" &&
    typeof value.thinking === "string" &&
    isOptionalString(value.thinkingSignature) &&
    isOptionalBoolean(value.redacted)
  );
}

function isToolCallContent(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    value.type === "toolCall" &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isPlainRecord(value.arguments) &&
    isOptionalString(value.thoughtSignature) &&
    isOptionalString(value.namespace)
  );
}

function isContentArray(
  value: unknown,
  validators: readonly ((part: unknown) => boolean)[],
): boolean {
  return Array.isArray(value) && value.every((part) => validators.some((validator) => validator(part)));
}

function isTextOrImageContent(value: unknown): boolean {
  return isContentArray(value, [isTextContent, isImageContent]);
}

function isUsage(value: unknown): boolean {
  if (!isPlainRecord(value) || !isPlainRecord(value.cost)) return false;
  const cost = value.cost;
  const numericFields = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
  const costFields = ["input", "output", "cacheRead", "cacheWrite", "total"];
  return (
    numericFields.every((field) => isNonNegativeNumber(value[field])) &&
    costFields.every((field) => isNonNegativeNumber(cost[field])) &&
    (value.cacheWrite1h === undefined || isNonNegativeNumber(value.cacheWrite1h)) &&
    (value.reasoning === undefined || isNonNegativeNumber(value.reasoning))
  );
}

function isAssistantDiagnostic(value: unknown): boolean {
  if (
    !isPlainRecord(value) ||
    typeof value.type !== "string" ||
    !isMessageTimestamp(value.timestamp) ||
    (value.details !== undefined && !isPlainRecord(value.details))
  ) {
    return false;
  }
  if (value.error === undefined) return true;
  if (!isPlainRecord(value.error) || typeof value.error.message !== "string") return false;
  return (
    isOptionalString(value.error.name) &&
    isOptionalString(value.error.stack) &&
    (value.error.code === undefined ||
      typeof value.error.code === "string" ||
      typeof value.error.code === "number")
  );
}

function isDeferredHandle(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    isNonEmptyString(value.provider) &&
    isNonEmptyString(value.modelId) &&
    isNonEmptyString(value.api) &&
    isNonEmptyString(value.id) &&
    (value.expiresAt === undefined || isNonNegativeNumber(value.expiresAt)) &&
    (value.pollAfterMs === undefined || isNonNegativeNumber(value.pollAfterMs))
  );
}

const ASSISTANT_STOP_REASONS = new Set([
  "pending",
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
  "deferred",
]);

function isUserMessage(value: Record<string, unknown>): boolean {
  return (
    value.role === "user" &&
    (typeof value.content === "string" || isTextOrImageContent(value.content)) &&
    isMessageTimestamp(value.timestamp)
  );
}

function isAssistantMessage(value: Record<string, unknown>): boolean {
  return (
    value.role === "assistant" &&
    isContentArray(value.content, [isTextContent, isThinkingContent, isToolCallContent]) &&
    isNonEmptyString(value.api) &&
    isNonEmptyString(value.provider) &&
    isNonEmptyString(value.model) &&
    isUsage(value.usage) &&
    typeof value.stopReason === "string" &&
    ASSISTANT_STOP_REASONS.has(value.stopReason) &&
    isMessageTimestamp(value.timestamp) &&
    isOptionalString(value.responseModel) &&
    isOptionalString(value.responseId) &&
    isOptionalString(value.errorMessage) &&
    isOptionalString(value.rawStopReason) &&
    isOptionalBoolean(value.endTurn) &&
    (value.diagnostics === undefined ||
      (Array.isArray(value.diagnostics) && value.diagnostics.every(isAssistantDiagnostic))) &&
    (value.deferred === undefined || isDeferredHandle(value.deferred))
  );
}

function isToolResultMessage(value: Record<string, unknown>): boolean {
  return (
    value.role === "toolResult" &&
    isNonEmptyString(value.toolCallId) &&
    isNonEmptyString(value.toolName) &&
    isTextOrImageContent(value.content) &&
    typeof value.isError === "boolean" &&
    isMessageTimestamp(value.timestamp) &&
    (value.usage === undefined || isUsage(value.usage)) &&
    (value.addedToolNames === undefined ||
      (Array.isArray(value.addedToolNames) && value.addedToolNames.every(isNonEmptyString)))
  );
}

function isBashExecutionMessage(value: Record<string, unknown>): boolean {
  return (
    value.role === "bashExecution" &&
    typeof value.command === "string" &&
    typeof value.output === "string" &&
    (value.exitCode === undefined || Number.isInteger(value.exitCode)) &&
    typeof value.cancelled === "boolean" &&
    typeof value.truncated === "boolean" &&
    isOptionalString(value.fullOutputPath) &&
    isOptionalBoolean(value.excludeFromContext) &&
    isMessageTimestamp(value.timestamp)
  );
}

function isCustomMessage(value: Record<string, unknown>): boolean {
  return (
    value.role === "custom" &&
    isNonEmptyString(value.customType) &&
    (typeof value.content === "string" || isTextOrImageContent(value.content)) &&
    typeof value.display === "boolean" &&
    isMessageTimestamp(value.timestamp)
  );
}

function isSessionMessage(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  switch (value.role) {
    case "user":
      return isUserMessage(value);
    case "assistant":
      return isAssistantMessage(value);
    case "toolResult":
      return isToolResultMessage(value);
    case "bashExecution":
      return isBashExecutionMessage(value);
    case "custom":
      return isCustomMessage(value);
    default:
      return false;
  }
}

async function readStableAppendableFile(filePath: string): Promise<Buffer> {
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  const handle = await open(
    filePath,
    constants.O_RDWR | constants.O_APPEND | noFollow,
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      (process.platform !== "win32" && (before.mode & 0o222) === 0)
    ) {
      throw sessionFileViolation();
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== after.size ||
      !after.isFile() ||
      after.nlink !== 1
    ) {
      throw sessionFileViolation();
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function validateSessionHeader(
  value: Record<string, unknown>,
  repositoryRoot: string | undefined,
): void {
  const validRepository =
    repositoryRoot === undefined ||
    (typeof value.cwd === "string" && path.resolve(value.cwd) === repositoryRoot);
  if (
    value.type !== "session" ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    !isValidTimestamp(value.timestamp) ||
    typeof value.cwd !== "string" ||
    value.version !== CURRENT_SESSION_VERSION ||
    (value.parentSession !== undefined && typeof value.parentSession !== "string") ||
    !validRepository
  ) {
    throw sessionFileViolation();
  }
}

function validateSessionEntry(
  value: Record<string, unknown>,
  knownIds: Set<string>,
): void {
  const parentId = value.parentId;
  if (
    value.type === "session" ||
    typeof value.type !== "string" ||
    value.type.length === 0 ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    knownIds.has(value.id) ||
    (parentId !== null && typeof parentId !== "string") ||
    (typeof parentId === "string" && !knownIds.has(parentId)) ||
    !isValidTimestamp(value.timestamp)
  ) {
    throw sessionFileViolation();
  }

  switch (value.type) {
    case "message":
      if (!isSessionMessage(value.message)) throw sessionFileViolation();
      break;
    case "thinking_level_change":
      if (!isNonEmptyString(value.thinkingLevel)) throw sessionFileViolation();
      break;
    case "model_change":
      if (!isNonEmptyString(value.provider) || !isNonEmptyString(value.modelId)) {
        throw sessionFileViolation();
      }
      break;
    case "compaction":
      if (
        typeof value.summary !== "string" ||
        !isNonEmptyString(value.firstKeptEntryId) ||
        !knownIds.has(value.firstKeptEntryId) ||
        !isNonNegativeNumber(value.tokensBefore) ||
        (value.usage !== undefined && !isUsage(value.usage)) ||
        !isOptionalBoolean(value.fromHook)
      ) {
        throw sessionFileViolation();
      }
      break;
    case "branch_summary":
      if (
        !isNonEmptyString(value.fromId) ||
        (value.fromId !== "root" && !knownIds.has(value.fromId)) ||
        typeof value.summary !== "string" ||
        (value.usage !== undefined && !isUsage(value.usage)) ||
        !isOptionalBoolean(value.fromHook)
      ) {
        throw sessionFileViolation();
      }
      break;
    case "custom":
      if (!isNonEmptyString(value.customType)) throw sessionFileViolation();
      break;
    case "custom_message":
      if (
        !isNonEmptyString(value.customType) ||
        (typeof value.content !== "string" && !isTextOrImageContent(value.content)) ||
        typeof value.display !== "boolean"
      ) {
        throw sessionFileViolation();
      }
      break;
    case "label":
      if (
        !isNonEmptyString(value.targetId) ||
        !knownIds.has(value.targetId) ||
        !isOptionalString(value.label)
      ) {
        throw sessionFileViolation();
      }
      break;
    case "session_info":
      if (!isOptionalString(value.name)) throw sessionFileViolation();
      break;
    default:
      throw sessionFileViolation();
  }
  knownIds.add(value.id);
}

async function validateSessionFile(
  filePath: string,
  repositoryRoot: string | undefined,
): Promise<void> {
  try {
    const entry = await lstat(filePath);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1) {
      throw sessionFileViolation();
    }
    const bytes = await readStableAppendableFile(filePath);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const knownIds = new Set<string>();
    let parsedCount = 0;

    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw sessionFileViolation();
      }
      if (!isPlainRecord(value)) throw sessionFileViolation();
      if (parsedCount === 0) validateSessionHeader(value, repositoryRoot);
      else validateSessionEntry(value, knownIds);
      parsedCount += 1;
    }

    if (parsedCount === 0) throw sessionFileViolation();
  } catch (error) {
    if (error instanceof Error && error.name === "SessionFileContractViolation") {
      throw error;
    }
    throw sessionFileViolation();
  }
}

export interface ValidateSessionFilesOptions {
  repositoryRoot?: string;
}

export async function validateSessionFiles(
  directory: string,
  options: ValidateSessionFilesOptions = {},
): Promise<void> {
  try {
    const repositoryRoot = options.repositoryRoot
      ? path.resolve(options.repositoryRoot)
      : undefined;
    const names = await readdir(directory);
    for (const name of names.sort()) {
      if (!name.endsWith(".jsonl")) continue;
      await validateSessionFile(path.join(directory, name), repositoryRoot);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "SessionFileContractViolation") {
      throw error;
    }
    throw sessionFileViolation();
  }
}

interface SessionLeaseRecord {
  readonly version: typeof SESSION_LEASE_VERSION;
  readonly pid: number;
  readonly nonce: string;
}

export interface AcquireSessionDirectoryLeaseOptions {
  processId?: number;
  processNonce?: string;
}

export interface SessionDirectoryLease {
  release(): Promise<void>;
}

type LeaseSnapshot =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "valid"; record: SessionLeaseRecord };

function isSessionLeaseRecord(value: unknown): value is SessionLeaseRecord {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 3 &&
    keys[0] === "nonce" &&
    keys[1] === "pid" &&
    keys[2] === "version" &&
    value.version === SESSION_LEASE_VERSION &&
    Number.isInteger(value.pid) &&
    Number(value.pid) > 0 &&
    typeof value.nonce === "string" &&
    value.nonce.length > 0 &&
    Buffer.byteLength(value.nonce, "utf8") <= 128
  );
}

function sessionDirectoryBusy(): Error {
  return fixedError("SessionDirectoryBusy", "Session directory already has a writer");
}

async function readSessionLease(leasePath: string): Promise<LeaseSnapshot> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
    handle = await open(leasePath, constants.O_RDONLY | noFollow);
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size <= 0 ||
      before.size > MAX_SESSION_LEASE_BYTES ||
      (process.platform !== "win32" && (before.mode & 0o777) !== 0o600)
    ) {
      return { status: "invalid" };
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== after.size ||
      !after.isFile() ||
      after.nlink !== 1
    ) {
      return { status: "invalid" };
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    return isSessionLeaseRecord(value)
      ? { status: "valid", record: value }
      : { status: "invalid" };
  } catch (error) {
    return (error as ErrorWithCode).code === "ENOENT"
      ? { status: "missing" }
      : { status: "invalid" };
  } finally {
    await handle?.close();
  }
}

async function tryCreateSessionLease(
  leasePath: string,
  record: SessionLeaseRecord,
): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(leasePath, "wx", 0o600);
  } catch (error) {
    if ((error as ErrorWithCode).code === "EEXIST") return false;
    throw fixedError(
      "SessionDirectoryPermissionError",
      "Session directory lease could not be created",
    );
  }

  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
    const entry = await handle.stat();
    if (
      !entry.isFile() ||
      entry.nlink !== 1 ||
      (process.platform !== "win32" && (entry.mode & 0o777) !== 0o600) ||
      entry.size <= 0 ||
      entry.size > MAX_SESSION_LEASE_BYTES
    ) {
      throw fixedError(
        "SessionDirectoryPermissionError",
        "Session directory lease is not private",
      );
    }
    return true;
  } catch (error) {
    try {
      await unlink(leasePath);
    } catch {
      // Preserve the fixed creation failure.
    }
    if (error instanceof Error && error.name === "SessionDirectoryPermissionError") {
      throw error;
    }
    throw fixedError(
      "SessionDirectoryPermissionError",
      "Session directory lease could not be created",
    );
  } finally {
    await handle.close();
  }
}

async function removeOwnedSessionLease(
  leasePath: string,
  expected: SessionLeaseRecord,
): Promise<boolean> {
  const snapshot = await readSessionLease(leasePath);
  if (
    snapshot.status !== "valid" ||
    snapshot.record.pid !== expected.pid ||
    snapshot.record.nonce !== expected.nonce
  ) {
    return false;
  }
  try {
    await unlink(leasePath);
    return true;
  } catch (error) {
    if ((error as ErrorWithCode).code === "ENOENT") return false;
    throw fixedError(
      "SessionDirectoryPermissionError",
      "Session directory lease could not be released",
    );
  }
}

export async function acquireSessionDirectoryLease(
  directory: string,
  options: AcquireSessionDirectoryLeaseOptions = {},
): Promise<SessionDirectoryLease> {
  const record: SessionLeaseRecord = {
    version: SESSION_LEASE_VERSION,
    pid: options.processId ?? process.pid,
    nonce: options.processNonce ?? randomUUID(),
  };
  if (!isSessionLeaseRecord(record)) {
    throw fixedError(
      "SessionDirectoryContractViolation",
      "Session directory lease owner is invalid",
    );
  }

  const leasePath = path.join(directory, SESSION_LEASE_FILE);
  if (!(await tryCreateSessionLease(leasePath, record))) throw sessionDirectoryBusy();

  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await removeOwnedSessionLease(leasePath, record);
    },
  };
}

export async function ensurePrivateSessionDirectory(
  directory: string,
  options: PrivateSessionDirectoryOptions = {},
): Promise<void> {
  try {
    const prospectiveDirectory = await canonicalizeProspectivePath(directory);
    const canonicalRepository = options.repositoryRoot
      ? await realpath(path.resolve(options.repositoryRoot))
      : undefined;

    if (canonicalRepository && isPathInside(canonicalRepository, prospectiveDirectory)) {
      throw fixedError(
        "SessionDirectoryContractViolation",
        "Session directory must remain outside the repository",
      );
    }

    const created = await createSessionDirectory(prospectiveDirectory);
    const originalEntry = await lstat(path.resolve(directory));
    if (originalEntry.isSymbolicLink() || !originalEntry.isDirectory()) {
      throw fixedError(
        "SessionDirectoryContractViolation",
        "Session directory must not be a symbolic link and must be a dedicated directory",
      );
    }

    const canonicalDirectory = await realpath(prospectiveDirectory);
    if (canonicalRepository && isPathInside(canonicalRepository, canonicalDirectory)) {
      throw fixedError(
        "SessionDirectoryContractViolation",
        "Session directory must remain outside the repository",
      );
    }

    if (created) {
      await writeFile(
        path.join(canonicalDirectory, SESSION_OWNER_MARKER_FILE),
        SESSION_OWNER_MARKER_CONTENT,
        { flag: "wx", mode: 0o600 },
      );
    }
    await validateOwnedSessionDirectory(canonicalDirectory);

    if (process.platform !== "win32") {
      await chmod(canonicalDirectory, 0o700);
      const mode = (await stat(canonicalDirectory)).mode & 0o777;
      if (mode !== 0o700) {
        throw fixedError(
          "SessionDirectoryPermissionError",
          "Session directory permissions are not private",
        );
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "SessionDirectoryContractViolation" ||
        error.name === "SessionDirectoryPermissionError")
    ) {
      throw error;
    }
    throw fixedError(
      "SessionDirectoryPermissionError",
      "Session directory could not be prepared privately",
    );
  }
}

interface PersistedEntryLike {
  readonly type?: unknown;
  readonly message?: unknown;
}

export function hasPersistedAssistantMessage(
  entries: readonly PersistedEntryLike[],
  assistantTimestamp: number,
): boolean {
  return entries.some((entry) => {
    if (entry.type !== "message" || !isRecord(entry.message)) return false;
    return (
      entry.message.role === "assistant" &&
      entry.message.timestamp === assistantTimestamp
    );
  });
}

export interface FinalAssistantSnapshot {
  readonly role: string;
  readonly content: readonly unknown[];
  readonly stopReason: string;
  readonly timestamp: number;
}

export interface TaskCompletionInput {
  readonly promptSucceeded: boolean;
  readonly settled: boolean;
  readonly finalAssistant: FinalAssistantSnapshot | undefined;
  readonly saved: boolean;
  readonly cancelRequested: boolean;
}

function failedResult(errorKind: string, stage: "PROMPT" | "RUNTIME" = "RUNTIME"): TaskRunResult {
  return { outcome: "failed", stage, errorKind };
}

function assistantText(message: FinalAssistantSnapshot): string {
  return sanitizeAnswer(
    message.content
      .filter(isRecord)
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text))
      .join(""),
  ).trim();
}

export function classifyTaskCompletion(input: TaskCompletionInput): TaskRunResult {
  if (input.cancelRequested || input.finalAssistant?.stopReason === "aborted") {
    return { outcome: "cancelled", saved: input.saved };
  }
  if (!input.promptSucceeded) return failedResult("PromptFailure", "PROMPT");
  if (!input.settled) return failedResult("SettlementMissing");
  if (!input.finalAssistant || input.finalAssistant.role !== "assistant") {
    return failedResult("AssistantMissing");
  }
  if (input.finalAssistant.stopReason !== "stop") return failedResult("AssistantNotNormal");

  const answer = assistantText(input.finalAssistant);
  if (answer.length === 0) return failedResult("EmptyAssistantAnswer");
  if (!input.saved) return failedResult("PersistenceUnconfirmed");
  return { outcome: "completed", answer, saved: true };
}

export interface TaskResourceLoaderOptions {
  cwd: string;
  agentDirectory: string;
  settingsManager?: SettingsManager;
}

function resourceContractViolation(): Error {
  return fixedError(
    "ResourceContractViolation",
    "Repository context file does not match the task contract",
  );
}

async function readRepositoryContextSnapshot(filePath: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const original = await lstat(filePath);
    if (original.isSymbolicLink() || !original.isFile() || original.nlink !== 1) {
      throw resourceContractViolation();
    }

    const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
    handle = await open(filePath, constants.O_RDONLY | noFollow);
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      original.dev !== before.dev ||
      original.ino !== before.ino
    ) {
      throw resourceContractViolation();
    }

    const bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await lstat(filePath);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== after.size ||
      !after.isFile() ||
      after.nlink !== 1 ||
      current.isSymbolicLink() ||
      !current.isFile() ||
      current.nlink !== 1 ||
      current.dev !== after.dev ||
      current.ino !== after.ino ||
      current.size !== after.size ||
      current.mtimeMs !== after.mtimeMs
    ) {
      throw resourceContractViolation();
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceContractViolation") {
      throw error;
    }
    throw resourceContractViolation();
  } finally {
    try {
      await handle?.close();
    } catch {
      throw resourceContractViolation();
    }
  }
}

function assertTaskResourceContract(loader: DefaultResourceLoader, cwd: string): void {
  const rootContextPath = path.join(path.resolve(cwd), "AGENTS.md");
  const contextFiles = loader.getAgentsFiles().agentsFiles;
  const exactRootContextLoaded =
    contextFiles.length === 1 && path.resolve(contextFiles[0]?.path ?? "") === rootContextPath;
  const invalid =
    loader.getExtensions().extensions.length !== 0 ||
    loader.getExtensions().errors.length !== 0 ||
    loader.getSkills().skills.length !== 0 ||
    loader.getSkills().diagnostics.length !== 0 ||
    loader.getPrompts().prompts.length !== 0 ||
    loader.getPrompts().diagnostics.length !== 0 ||
    loader.getThemes().themes.length !== 0 ||
    loader.getThemes().diagnostics.length !== 0 ||
    loader.getSystemPrompt() !== undefined ||
    loader.getSystemPromptSource() !== undefined ||
    loader.getAppendSystemPrompt().length !== 0 ||
    loader.getAppendSystemPromptSources().length !== 0 ||
    !exactRootContextLoaded;
  if (invalid) {
    throw fixedError(
      "ResourceContractViolation",
      "Only the repository context file may be loaded",
    );
  }
}

export async function createTaskResourceLoader(
  options: TaskResourceLoaderOptions,
): Promise<DefaultResourceLoader> {
  const rootContextPath = path.join(path.resolve(options.cwd), "AGENTS.md");
  const rootContextContent = await readRepositoryContextSnapshot(rootContextPath);
  const settingsManager =
    options.settingsManager ??
    SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, provider: { maxRetries: 0 } },
    });
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDirectory,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "",
    appendSystemPrompt: [],
    agentsFilesOverride: () => ({
      agentsFiles: [{ path: rootContextPath, content: rootContextContent }],
    }),
  });
  await loader.reload();
  assertTaskResourceContract(loader, options.cwd);
  return loader;
}

export interface TaskSdkSessionPort {
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string, options: { expandPromptTemplates: false }): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
  getActiveToolNames(): string[];
}

export interface TaskSdkSessionManagerPort {
  getEntries(): readonly PersistedEntryLike[];
}

export interface TaskSdkContext {
  session: TaskSdkSessionPort;
  sessionManager: TaskSdkSessionManagerPort;
  readyInfo: ReadyInfo;
  releaseLease?: () => Promise<void>;
}

export interface CreateTaskSdkContextInput {
  repositoryRoot: string;
  sessionDirectory: string;
}

export type CreateTaskSdkContext = (
  input: CreateTaskSdkContextInput,
) => Promise<TaskSdkContext>;

function hasStrictReadTools(tools: readonly string[]): boolean {
  return tools.length === 1 && tools[0] === "read";
}

type TaskBeforeToolCallHook = NonNullable<
  Awaited<ReturnType<typeof createAgentSession>>["session"]["agent"]["beforeToolCall"]
>;

interface TaskReadPathGateAgent {
  beforeToolCall?: TaskBeforeToolCallHook;
}

interface TaskReadPathGateSession {
  readonly agent: TaskReadPathGateAgent;
}

function blockedTaskRead(): { block: true; reason: string } {
  return { block: true, reason: TASK_READ_PATH_BLOCK_REASON };
}

async function isAllowedTaskRead(
  args: unknown,
  repositoryRoot: string,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (signal?.aborted || !isPlainRecord(args) || typeof args.path !== "string") {
    return false;
  }

  const allowedAbsolutePath = path.resolve(repositoryRoot, TASK_READ_RELATIVE_PATH);
  if (
    args.path !== TASK_READ_RELATIVE_PATH &&
    args.path !== allowedAbsolutePath
  ) {
    return false;
  }

  try {
    const resolvedRepositoryRoot = path.resolve(repositoryRoot);
    const repositoryEntry = await lstat(resolvedRepositoryRoot);
    const canonicalRepositoryRoot = await realpath(resolvedRepositoryRoot);
    if (
      signal?.aborted ||
      repositoryEntry.isSymbolicLink() ||
      !repositoryEntry.isDirectory() ||
      canonicalRepositoryRoot !== resolvedRepositoryRoot
    ) {
      return false;
    }

    const entry = await lstat(allowedAbsolutePath);
    const canonicalAllowedPath = await realpath(allowedAbsolutePath);
    if (signal?.aborted) return false;
    // The SDK executor accepts only a pathname, so same-user replacement after
    // this check remains a TOCTOU boundary.
    return (
      canonicalAllowedPath ===
        path.resolve(canonicalRepositoryRoot, TASK_READ_RELATIVE_PATH) &&
      !entry.isSymbolicLink() &&
      entry.isFile() &&
      entry.nlink === 1
    );
  } catch {
    return false;
  }
}

export function installTaskReadPathGate(
  agent: TaskReadPathGateAgent,
  repositoryRoot: string,
): void {
  const existingBeforeToolCall = agent.beforeToolCall;
  agent.beforeToolCall = async (context, signal) => {
    const isRead = context.toolCall.name === "read";
    if (isRead && !(await isAllowedTaskRead(context.args, repositoryRoot, signal))) {
      return blockedTaskRead();
    }
    if (!existingBeforeToolCall) return undefined;

    const existingResult = await existingBeforeToolCall(context, signal);
    if (existingResult?.block) return existingResult;
    if (isRead && !(await isAllowedTaskRead(context.args, repositoryRoot, signal))) {
      return blockedTaskRead();
    }
    return existingResult;
  };
}

export function installTaskReadPathGateForSession(
  session: TaskReadPathGateSession,
  repositoryRoot: string,
): void {
  installTaskReadPathGate(session.agent, repositoryRoot);
}

function assertTaskSettings(settingsManager: SettingsManager): void {
  const providerRetry = settingsManager.getProviderRetrySettings();
  if (
    settingsManager.getCompactionEnabled() ||
    settingsManager.getRetryEnabled() ||
    providerRetry.maxRetries !== 0
  ) {
    throw fixedError("ResourceContractViolation", "Retry and compaction must remain disabled");
  }
}

async function createDefaultTaskSdkContext(
  input: CreateTaskSdkContextInput,
): Promise<TaskSdkContext> {
  await ensurePrivateSessionDirectory(input.sessionDirectory, {
    repositoryRoot: input.repositoryRoot,
  });
  const canonicalSessionDirectory = await realpath(input.sessionDirectory);
  const lease = await acquireSessionDirectoryLease(canonicalSessionDirectory);
  let createdSession: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    await validateSessionFiles(canonicalSessionDirectory, {
      repositoryRoot: input.repositoryRoot,
    });
    const agentDirectory = getAgentDir();
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, provider: { maxRetries: 0 } },
    });
    assertTaskSettings(settingsManager);

    const resourceLoader = await createTaskResourceLoader({
      cwd: input.repositoryRoot,
      agentDirectory,
      settingsManager,
    });
    const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
    const model = modelRuntime.getModel(PROVIDER_ID, MODEL_ID);
    if (!model) {
      throw fixedError("ModelContractViolation", "Configured task model is unavailable");
    }

    const sessionManager = SessionManager.continueRecent(
      input.repositoryRoot,
      canonicalSessionDirectory,
    );
    const resumed = sessionManager.getEntries().length > 0;
    const created = await createAgentSession({
      cwd: input.repositoryRoot,
      agentDir: agentDirectory,
      model,
      thinkingLevel: "off",
      modelRuntime,
      resourceLoader,
      tools: ["read"],
      sessionManager,
      settingsManager,
    });
    createdSession = created.session;
    installTaskReadPathGateForSession(created.session, input.repositoryRoot);
    if (created.extensionsResult.errors.length > 0 || created.modelFallbackMessage) {
      throw fixedError("ResourceContractViolation", "Task runtime initialization was not exact");
    }

    const activeTools = created.session.getActiveToolNames();
    if (
      created.session.model?.provider !== PROVIDER_ID ||
      created.session.model.id !== MODEL_ID ||
      created.session.thinkingLevel !== "off" ||
      !hasStrictReadTools(activeTools)
    ) {
      throw fixedError("ModelContractViolation", "Task runtime model or tool state is not exact");
    }

    return {
      session: {
        subscribe: (listener) => created.session.subscribe((event) => listener(event)),
        prompt: (text, options) => created.session.prompt(text, options),
        abort: () => created.session.abort(),
        dispose: () => created.session.dispose(),
        getActiveToolNames: () => created.session.getActiveToolNames(),
      },
      sessionManager,
      readyInfo: {
        session: resumed ? "RESUMED" : "NEW",
        model: MODEL_NAME,
        tools: [...activeTools],
      },
      releaseLease: lease.release,
    };
  } catch (error) {
    let cleanupFailed = false;
    try {
      createdSession?.dispose();
    } catch {
      cleanupFailed = true;
    }
    try {
      await lease.release();
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) throw new SdkContextInitializationFailure(error);
    throw error;
  }
}

interface DeferredVoid {
  promise: Promise<void>;
  resolve(): void;
}

function deferredVoid(): DeferredVoid {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

interface ActiveRun {
  baselineEntries: PersistedEntryLike[];
  finalAssistant?: FinalAssistantSnapshot;
  promptSucceeded: boolean;
  settled: boolean;
  cancelRequested: boolean;
  toolContractViolated: boolean;
  cancellationFailed: boolean;
  finished: boolean;
  abortOperations: Set<Promise<void>>;
  done: DeferredVoid;
}

export interface SdkTaskConsoleRuntimeOptions {
  repositoryRoot?: string;
  sessionDirectory?: string;
  env?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
  createSdkContext?: CreateTaskSdkContext;
}

export class SdkTaskConsoleRuntime implements TaskConsoleRuntimePort {
  readonly #repositoryRoot: string;
  readonly #sessionDirectory: string;
  readonly #createSdkContext: CreateTaskSdkContext;
  readonly #listeners = new Set<(record: ConsoleRecord) => void>();
  readonly #activeReadCalls = new Set<string>();
  #context: TaskSdkContext | undefined;
  #sdkUnsubscribe: (() => void) | undefined;
  #releaseLease: (() => Promise<void>) | undefined;
  #activeRun: ActiveRun | undefined;
  #closePromise: Promise<void> | undefined;
  #pendingCleanupFailure = false;
  #closed = false;

  constructor(options: SdkTaskConsoleRuntimeOptions = {}) {
    this.#repositoryRoot = path.resolve(
      options.repositoryRoot ?? path.resolve(import.meta.dirname, "../.."),
    );
    this.#sessionDirectory = path.resolve(
      options.sessionDirectory ??
        resolveSessionDirectory({
          env: options.env ?? process.env,
          homeDirectory: options.homeDirectory ?? os.homedir(),
        }),
    );
    this.#createSdkContext = options.createSdkContext ?? createDefaultTaskSdkContext;
  }

  async initialize(): Promise<ReadyInfo> {
    if (this.#closed) throw fixedError("RuntimeClosed", "Task runtime is closed");
    if (this.#context) return this.#copyReadyInfo(this.#context.readyInfo);

    let context: TaskSdkContext;
    try {
      context = await this.#createSdkContext({
        repositoryRoot: this.#repositoryRoot,
        sessionDirectory: this.#sessionDirectory,
      });
    } catch (error) {
      if (error instanceof SdkContextInitializationFailure) {
        this.#pendingCleanupFailure = true;
        throw error.primaryError;
      }
      throw error;
    }
    this.#context = context;
    this.#releaseLease = context.releaseLease;
    try {
      const activeTools = context.session.getActiveToolNames();
      if (!hasStrictReadTools(activeTools) || !hasStrictReadTools(context.readyInfo.tools)) {
        throw fixedError("ToolContractViolation", "Active tools must be exactly read");
      }
      if (context.readyInfo.model !== MODEL_NAME) {
        throw fixedError("ModelContractViolation", "Active model must match the task contract");
      }
      this.#sdkUnsubscribe = context.session.subscribe((event) => {
        try {
          this.#handleSessionEvent(event);
        } catch {
          const run = this.#activeRun;
          if (run) this.#markToolContractViolation(run);
        }
      });
      return this.#copyReadyInfo(context.readyInfo);
    } catch (error) {
      let cleanupFailed = false;
      const unsubscribe = this.#sdkUnsubscribe;
      this.#sdkUnsubscribe = undefined;
      try {
        unsubscribe?.();
      } catch {
        cleanupFailed = true;
      }
      this.#context = undefined;
      try {
        context.session.dispose();
      } catch {
        cleanupFailed = true;
      }
      try {
        await this.#releaseLeaseOnce();
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) this.#pendingCleanupFailure = true;
      throw error;
    }
  }

  subscribe(listener: (record: ConsoleRecord) => void): () => void {
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  async runTask(text: string): Promise<TaskRunResult> {
    const context = this.#requireContext();
    if (this.#activeRun) return failedResult("ConcurrentRun");
    if (!hasStrictReadTools(context.session.getActiveToolNames())) {
      return failedResult("ToolContractViolation");
    }

    const run: ActiveRun = {
      baselineEntries: [...context.sessionManager.getEntries()],
      promptSucceeded: false,
      settled: false,
      cancelRequested: false,
      toolContractViolated: false,
      cancellationFailed: false,
      finished: false,
      abortOperations: new Set(),
      done: deferredVoid(),
    };
    this.#activeRun = run;
    this.#activeReadCalls.clear();

    try {
      try {
        await context.session.prompt(text, { expandPromptTemplates: false });
        run.promptSucceeded = true;
      } catch {
        run.promptSucceeded = false;
      }

      await this.#drainAbortOperations(run);
      if (!hasStrictReadTools(context.session.getActiveToolNames())) {
        run.toolContractViolated = true;
      }
      if (run.toolContractViolated) return failedResult("ToolContractViolation");
      if (run.cancellationFailed) {
        return failedResult("CancellationFailure");
      }

      const persistedEntries = context.sessionManager.getEntries();
      const assistantTimestamp = run.finalAssistant?.timestamp;
      const saved =
        assistantTimestamp !== undefined &&
        persistedEntries.length > run.baselineEntries.length &&
        !hasPersistedAssistantMessage(run.baselineEntries, assistantTimestamp) &&
        hasPersistedAssistantMessage(persistedEntries, assistantTimestamp);

      return classifyTaskCompletion({
        promptSucceeded: run.promptSucceeded,
        settled: run.settled,
        finalAssistant: run.finalAssistant,
        saved,
        cancelRequested: run.cancelRequested,
      });
    } finally {
      run.finished = true;
      this.#activeReadCalls.clear();
      if (this.#activeRun === run) this.#activeRun = undefined;
      run.done.resolve();
    }
  }

  async cancel(): Promise<boolean> {
    const run = this.#activeRun;
    if (!run || run.finished) return false;
    run.cancelRequested = true;
    await this.#requestAbort(run);
    return true;
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    if (this.#closed) return Promise.resolve();
    this.#closePromise = this.#performClose();
    return this.#closePromise;
  }

  async #performClose(): Promise<void> {
    let cleanupFailed = this.#pendingCleanupFailure;
    this.#pendingCleanupFailure = false;
    const run = this.#activeRun;
    if (run && !run.finished) {
      try {
        run.cancelRequested = true;
        await this.#requestAbort(run);
        await run.done.promise;
        if (run.cancellationFailed) cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
    }

    const unsubscribe = this.#sdkUnsubscribe;
    this.#sdkUnsubscribe = undefined;
    try {
      unsubscribe?.();
    } catch {
      cleanupFailed = true;
    }
    const context = this.#context;
    this.#context = undefined;
    try {
      context?.session.dispose();
    } catch {
      cleanupFailed = true;
    }
    try {
      await this.#releaseLeaseOnce();
    } catch {
      cleanupFailed = true;
    }
    this.#listeners.clear();
    this.#closed = true;
    if (cleanupFailed) {
      throw fixedError("ShutdownFailure", "Task runtime shutdown failed");
    }
  }

  async #releaseLeaseOnce(): Promise<void> {
    const releaseLease = this.#releaseLease;
    this.#releaseLease = undefined;
    await releaseLease?.();
  }

  #copyReadyInfo(readyInfo: ReadyInfo): ReadyInfo {
    return {
      session: readyInfo.session,
      model: readyInfo.model,
      tools: [...readyInfo.tools],
    };
  }

  #requireContext(): TaskSdkContext {
    if (this.#closed) throw fixedError("RuntimeClosed", "Task runtime is closed");
    if (!this.#context) {
      throw fixedError("RuntimeNotInitialized", "Task runtime is not initialized");
    }
    return this.#context;
  }

  #emit(record: ConsoleRecord): void {
    for (const listener of this.#listeners) {
      try {
        listener(record);
      } catch {
        // Output adapters cannot interrupt SDK persistence or agent settlement.
      }
    }
  }

  #handleSessionEvent(event: unknown): void {
    if (!isRecord(event) || typeof event.type !== "string") return;
    const run = this.#activeRun;
    if (!run || run.finished) return;

    const context = this.#context;
    if (!context || !hasStrictReadTools(context.session.getActiveToolNames())) {
      this.#markToolContractViolation(run);
    }

    if (event.type === "agent_start" && run.cancelRequested) {
      void this.#requestAbort(run);
    } else if (event.type === "agent_settled") {
      run.settled = true;
    } else if (event.type === "message_end") {
      const snapshot = this.#assistantSnapshot(event.message);
      if (snapshot) run.finalAssistant = snapshot;
    }

    if (event.type === "tool_execution_start") {
      if (event.toolName !== "read" || typeof event.toolCallId !== "string") {
        this.#markToolContractViolation(run);
        return;
      }
      this.#activeReadCalls.add(event.toolCallId);
      this.#emit({ status: "READING", tool: "read" });
      return;
    }

    if (event.type === "tool_execution_end") {
      if (
        event.toolName !== "read" ||
        typeof event.toolCallId !== "string" ||
        typeof event.isError !== "boolean"
      ) {
        this.#markToolContractViolation(run);
        return;
      }
      this.#activeReadCalls.delete(event.toolCallId);
      if (event.isError && !run.cancelRequested) this.#markToolContractViolation(run);
      this.#emit(
        this.#activeReadCalls.size > 0
          ? { status: "READING", tool: "read" }
          : { status: "RUNNING" },
      );
      return;
    }

    const projected = projectSessionEvent(event);
    if (projected) this.#emit(projected);
  }

  #assistantSnapshot(message: unknown): FinalAssistantSnapshot | undefined {
    if (!isRecord(message) || message.role !== "assistant") return undefined;
    if (
      !Array.isArray(message.content) ||
      typeof message.stopReason !== "string" ||
      typeof message.timestamp !== "number"
    ) {
      return undefined;
    }
    const textContent = message.content
      .filter(isRecord)
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => ({ type: "text", text: String(part.text) }));
    return {
      role: "assistant",
      content: textContent,
      stopReason: message.stopReason,
      timestamp: message.timestamp,
    };
  }

  #markToolContractViolation(run: ActiveRun): void {
    run.toolContractViolated = true;
    void this.#requestAbort(run);
  }

  #requestAbort(run: ActiveRun): Promise<void> {
    if (run.finished || !this.#context) return Promise.resolve();
    const session = this.#context.session;
    let operation!: Promise<void>;
    operation = Promise.resolve()
      .then(() => session.abort())
      .catch(() => {
        run.cancellationFailed = true;
      })
      .finally(() => {
        run.abortOperations.delete(operation);
      });
    run.abortOperations.add(operation);
    return operation;
  }

  async #drainAbortOperations(run: ActiveRun): Promise<void> {
    while (run.abortOperations.size > 0) {
      await Promise.all([...run.abortOperations]);
    }
  }
}
