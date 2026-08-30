import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

import {
  failureRecord,
  formatAnswer,
  formatConsoleRecord,
  type ConsoleRecord,
} from "./safe-output.ts";
import { TaskConsoleController } from "./task-console-controller.ts";
import { SdkTaskConsoleRuntime } from "./task-console-runtime.ts";

const SMOKE_TIMEOUT_MS = 60_000;
const SMOKE_CANCEL_GRACE_MS = 5_000;
const INTERACTIVE_SHUTDOWN_GRACE_MS = 5_000;
const SMOKE_EXPECTED_ANSWER = "TASK_CONSOLE_REAL_MARKER_7701";
const SMOKE_TASK = [
  "Use the read tool exactly once to read labs/7.7-sdk-task-console/fixture.txt.",
  "Do not use any other tool.",
  "Reply with exactly the marker text from the file, without Markdown or explanation.",
].join(" ");

interface ConsoleOutputState {
  completedSaved: boolean;
  failed: boolean;
  cancelled: boolean;
  readingRecordCount: number;
  answer?: string;
}

type TextWriter = (text: string) => void;

export interface InteractiveControllerPort {
  start(): Promise<unknown>;
  handleLine(line: string): Promise<unknown>;
}

export interface InteractiveRunOptions {
  shutdownGraceMs?: number;
  createController?: (state: ConsoleOutputState) => InteractiveControllerPort;
  hardExit?: (code: number) => void;
  setExitCode?: (code: number) => void;
}

export interface SmokeControllerPort {
  start(): Promise<unknown>;
  handleLine(line: string): Promise<unknown>;
  waitForIdle(): Promise<void>;
}

interface StartableControllerPort {
  start(): Promise<unknown>;
}

export interface SmokeRunOptions {
  timeoutMs?: number;
  cancelGraceMs?: number;
  createController?: (state: ConsoleOutputState) => SmokeControllerPort;
  emitRecord?: (record: ConsoleRecord) => void;
  hardExit?: (code: number) => void;
  setExitCode?: (code: number) => void;
}

function writeRecord(
  record: ConsoleRecord,
  state: ConsoleOutputState,
  write: TextWriter = (text) => {
    process.stdout.write(text);
  },
): void {
  write(`${formatConsoleRecord(record)}\n`);
  if (record.status === "COMPLETED" && record.saved) state.completedSaved = true;
  if (record.status === "FAILED") state.failed = true;
  if (record.status === "CANCELLED") state.cancelled = true;
  if (record.status === "READING") state.readingRecordCount += 1;
}

function writeAnswer(
  answer: string,
  state: ConsoleOutputState,
  write: TextWriter = (text) => {
    process.stdout.write(text);
  },
): void {
  state.answer = answer;
  write(`${formatAnswer(answer)}\n`);
}

function createController(
  state: ConsoleOutputState,
  write: TextWriter = (text) => {
    process.stdout.write(text);
  },
): TaskConsoleController {
  return new TaskConsoleController(new SdkTaskConsoleRuntime(), {
    onRecord: (record) => writeRecord(record, state, write),
    onAnswer: (answer) => writeAnswer(answer, state, write),
  });
}

async function startController(
  controller: StartableControllerPort,
  state: ConsoleOutputState,
  setExitCode: (code: number) => void = (code) => {
    process.exitCode = code;
  },
): Promise<boolean> {
  try {
    await controller.start();
    return true;
  } catch {
    state.failed = true;
    setExitCode(1);
    return false;
  }
}

export async function runSmoke(options: SmokeRunOptions = {}): Promise<void> {
  const state = createOutputState();
  const controller = (options.createController ?? createController)(state);
  const emitRecord = options.emitRecord ?? ((record) => writeRecord(record, state));
  const timeoutMs = options.timeoutMs ?? SMOKE_TIMEOUT_MS;
  const cancelGraceMs = options.cancelGraceMs ?? SMOKE_CANCEL_GRACE_MS;
  const hardExit = options.hardExit ?? ((code: number) => process.exit(code));
  const setExitCode =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });

  let forceExitTimer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const softTimeoutTimer = setTimeout(() => {
    timedOut = true;
    state.failed = true;
    emitRecord({ status: "FAILED", stage: "RUNTIME", errorKind: "SmokeTimeout" });
    void controller.handleLine("/cancel").catch(() => {});
    forceExitTimer = setTimeout(() => {
      hardExit(1);
    }, cancelGraceMs);
  }, timeoutMs);
  let started = false;
  try {
    if (!(await startController(controller, state, setExitCode))) return;
    started = true;
    if (!timedOut) {
      await controller.handleLine(SMOKE_TASK);
      await controller.waitForIdle();
    }
  } finally {
    clearTimeout(softTimeoutTimer);
    if (started) {
      try {
        await controller.handleLine("/quit");
      } catch {
        state.failed = true;
        emitRecord({
          status: "FAILED",
          stage: "SHUTDOWN",
          errorKind: "ShutdownFailure",
        });
      } finally {
        if (forceExitTimer) clearTimeout(forceExitTimer);
      }
    } else if (forceExitTimer) {
      clearTimeout(forceExitTimer);
    }
  }

  const accepted =
    state.completedSaved &&
    !state.failed &&
    !state.cancelled &&
    state.readingRecordCount === 1 &&
    state.answer === SMOKE_EXPECTED_ANSWER;
  if (!accepted) {
    if (!state.failed) {
      emitRecord({ status: "FAILED", stage: "RUNTIME", errorKind: "SmokeContractViolation" });
    }
    setExitCode(1);
  }
}

function isBrokenPipe(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "EPIPE";
}

export async function runInteractive(options: InteractiveRunOptions = {}): Promise<void> {
  const state = createOutputState();
  const shutdownGraceMs = Math.max(
    0,
    options.shutdownGraceMs ?? INTERACTIVE_SHUTDOWN_GRACE_MS,
  );
  const hardExit = options.hardExit ?? ((code: number) => process.exit(code));
  const setExitCode =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });
  let stdoutAvailable = true;
  let stderrAvailable = true;
  let terminal: readline.Interface | undefined;
  let terminalSigintListener: (() => void) | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let shutdownTimer: NodeJS.Timeout | undefined;
  let firstSignalCode: number | undefined;
  let requestedExitCode = 0;
  let hooksRemoved = false;
  const emittedShutdownKinds = new Set<string>();

  const writeStdout: TextWriter = (text) => {
    if (!stdoutAvailable) return;
    try {
      process.stdout.write(text);
    } catch (error) {
      onStdoutError(error instanceof Error ? error : new Error("stdout write failed"));
    }
  };
  const writeStderr: TextWriter = (text) => {
    if (!stderrAvailable) return;
    try {
      process.stderr.write(text);
    } catch {
      stderrAvailable = false;
    }
  };
  const controller = (options.createController ?? ((outputState) =>
    createController(outputState, writeStdout)))(state);

  let resolveStart!: (started: boolean) => void;
  const startSettled = new Promise<boolean>((resolve) => {
    resolveStart = resolve;
  });

  const publishExitCode = (code: number): void => {
    if (firstSignalCode !== undefined) {
      requestedExitCode = firstSignalCode;
    } else if (code !== 0) {
      requestedExitCode = code;
    }
    setExitCode(requestedExitCode);
  };

  const emitShutdownFailure = (errorKind: string): void => {
    if (emittedShutdownKinds.has(errorKind)) return;
    emittedShutdownKinds.add(errorKind);
    writeStderr(
      `${formatConsoleRecord({ status: "FAILED", stage: "SHUTDOWN", errorKind })}\n`,
    );
  };

  const removeHooks = (): void => {
    if (hooksRemoved) return;
    hooksRemoved = true;
    if (shutdownTimer) clearTimeout(shutdownTimer);
    shutdownTimer = undefined;
    if (terminal && terminalSigintListener) {
      terminal.off("SIGINT", terminalSigintListener);
    }
    terminal?.close();
    process.off("SIGINT", onProcessSigint);
    process.off("SIGTERM", onProcessSigterm);
    process.stdout.off("error", onStdoutError);
    process.stderr.off("error", onStderrError);
  };

  const forceExit = (code: number): void => {
    publishExitCode(code);
    removeHooks();
    hardExit(code);
  };

  const requestShutdown = (reason: "normal" | "broken-pipe"): Promise<void> => {
    if (reason === "broken-pipe") {
      emitShutdownFailure("BrokenPipe");
      if (firstSignalCode === undefined) publishExitCode(1);
    }
    if (shutdownPromise) return shutdownPromise;

    terminal?.close();
    shutdownPromise = (async () => {
      shutdownTimer = setTimeout(() => {
        emitShutdownFailure("ShutdownTimeout");
        forceExit(firstSignalCode ?? (requestedExitCode === 0 ? 1 : requestedExitCode));
      }, shutdownGraceMs);

      try {
        if (await startSettled) await controller.handleLine("/quit");
      } catch {
        emitShutdownFailure("ShutdownFailure");
        if (firstSignalCode === undefined) publishExitCode(1);
      } finally {
        if (shutdownTimer) clearTimeout(shutdownTimer);
        shutdownTimer = undefined;
        removeHooks();
        publishExitCode(firstSignalCode ?? requestedExitCode);
      }
    })();
    return shutdownPromise;
  };

  function handleSignal(code: 130 | 143): void {
    if (firstSignalCode !== undefined) {
      forceExit(firstSignalCode);
      return;
    }
    firstSignalCode = code;
    publishExitCode(code);
    void requestShutdown("normal");
  }

  function onProcessSigint(): void {
    handleSignal(130);
  }

  function onProcessSigterm(): void {
    handleSignal(143);
  }

  function onStdoutError(error: Error): void {
    stdoutAvailable = false;
    if (isBrokenPipe(error)) {
      void requestShutdown("broken-pipe");
      return;
    }
    emitShutdownFailure("ShutdownFailure");
    if (firstSignalCode === undefined) publishExitCode(1);
    void requestShutdown("normal");
  }

  function onStderrError(): void {
    stderrAvailable = false;
  }

  process.on("SIGINT", onProcessSigint);
  process.on("SIGTERM", onProcessSigterm);
  process.stdout.on("error", onStdoutError);
  process.stderr.on("error", onStderrError);

  const startAttempt = startController(controller, state, publishExitCode);
  void startAttempt.then(resolveStart, () => resolveStart(false));
  const started = await startAttempt;
  if (!started) {
    if (shutdownPromise) await shutdownPromise;
    else removeHooks();
    return;
  }
  if (shutdownPromise) {
    await shutdownPromise;
    return;
  }

  terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY && process.stdout.isTTY,
    crlfDelay: Infinity,
  });
  terminalSigintListener = () => handleSignal(130);
  terminal.on("SIGINT", terminalSigintListener);

  if (shutdownPromise) {
    terminal.close();
    await shutdownPromise;
    return;
  }

  try {
    for await (const line of terminal) {
      if (shutdownPromise) break;
      if (line.trim() === "/quit") {
        await requestShutdown("normal");
        break;
      }
      await controller.handleLine(line);
    }
  } finally {
    terminal.close();
    await requestShutdown("normal");
  }
}

function createOutputState(): ConsoleOutputState {
  return {
    completedSaved: false,
    failed: false,
    cancelled: false,
    readingRecordCount: 0,
  };
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes("--smoke")) await runSmoke();
  else await runInteractive();
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (executedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${formatConsoleRecord(failureRecord("RUNTIME", error))}\n`);
    process.exitCode = 1;
  });
}
