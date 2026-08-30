import {
  failureRecord,
  type ConsoleRecord,
  type FailureStage,
} from "./safe-output.ts";

export interface ReadyInfo {
  session: "NEW" | "RESUMED";
  model: string;
  tools: readonly string[];
}

export type TaskRunResult =
  | { outcome: "completed"; answer: string; saved: true }
  | { outcome: "cancelled"; saved: boolean }
  | { outcome: "failed"; stage: FailureStage; errorKind: string };

export interface TaskConsoleRuntimePort {
  initialize(): Promise<ReadyInfo>;
  subscribe(listener: (record: ConsoleRecord) => void): () => void;
  runTask(text: string): Promise<TaskRunResult>;
  cancel(): Promise<boolean>;
  close(): Promise<void>;
}

export interface TaskConsoleControllerOutput {
  onRecord(record: ConsoleRecord): void;
  onAnswer(answer: string): void;
}

export type HandleLineResult =
  | "IGNORED"
  | "STARTED"
  | "BUSY"
  | "INPUT_REJECTED"
  | "CANCEL_REQUESTED"
  | "NO_ACTIVE_TASK"
  | "QUIT";

export const MAX_INPUT_BYTES = 8192;

class ToolContractViolation extends Error {
  override readonly name = "ToolContractViolation";
}

class ModelContractViolation extends Error {
  override readonly name = "ModelContractViolation";
}

function shutdownFailure(): Error {
  const error = new Error("Task console shutdown failed");
  error.name = "ShutdownFailure";
  return error;
}

function hasStrictReadTools(tools: readonly string[]): boolean {
  return tools.length === 1 && tools[0] === "read";
}

export class TaskConsoleController {
  readonly #runtime: TaskConsoleRuntimePort;
  readonly #output: TaskConsoleControllerOutput;
  #readyInfo: ReadyInfo | undefined;
  #unsubscribe: (() => void) | undefined;
  #activeTask: Promise<void> | undefined;
  #quitPromise: Promise<"QUIT"> | undefined;
  #started = false;
  #quitting = false;
  #closed = false;

  constructor(runtime: TaskConsoleRuntimePort, output: TaskConsoleControllerOutput) {
    this.#runtime = runtime;
    this.#output = output;
  }

  async start(): Promise<ReadyInfo> {
    if (this.#started || this.#closed) throw new Error("Task console has already started");
    this.#output.onRecord({ status: "STARTING" });

    try {
      const readyInfo = await this.#runtime.initialize();
      if (!hasStrictReadTools(readyInfo.tools)) {
        throw new ToolContractViolation("Active tools must be exactly [read]");
      }
      if (readyInfo.model !== "openai/gpt-5.6-sol") {
        throw new ModelContractViolation("Active model must match the task console contract");
      }

      this.#readyInfo = {
        session: readyInfo.session,
        model: readyInfo.model,
        tools: [...readyInfo.tools],
      };
      this.#unsubscribe = this.#runtime.subscribe((record) => this.#output.onRecord(record));
      this.#started = true;
      this.#output.onRecord(this.#readyRecord());
      return this.#readyInfo;
    } catch (error) {
      this.#output.onRecord(failureRecord("STARTUP", error));
      const cleanupFailed = await this.#closeRuntimeAfterStartupFailure();
      if (cleanupFailed) {
        this.#output.onRecord({
          status: "FAILED",
          stage: "SHUTDOWN",
          errorKind: "ShutdownFailure",
        });
      }
      this.#closed = true;
      throw error;
    }
  }

  async handleLine(line: string): Promise<HandleLineResult> {
    const text = line.trim();
    const inputBytes = Buffer.byteLength(line, "utf8");
    if (text.length === 0 && (this.#activeTask || inputBytes <= MAX_INPUT_BYTES)) {
      return "IGNORED";
    }
    if (text === "/quit") return this.#quit();
    if (!this.#started || this.#closed) throw new Error("Task console is not ready");

    if (text === "/cancel") {
      if (!this.#activeTask) return "NO_ACTIVE_TASK";
      await this.#runtime.cancel();
      return "CANCEL_REQUESTED";
    }

    if (this.#activeTask) {
      this.#output.onRecord({ status: "BUSY" });
      return "BUSY";
    }

    if (inputBytes > MAX_INPUT_BYTES) {
      this.#output.onRecord({
        status: "FAILED",
        stage: "RUNTIME",
        errorKind: "InputTooLong",
      });
      this.#output.onRecord(this.#readyRecord());
      return "INPUT_REJECTED";
    }

    this.#startTask(text);
    return "STARTED";
  }

  async waitForIdle(): Promise<void> {
    await this.#activeTask;
  }

  #startTask(text: string): void {
    const operation = this.#executeTask(text);
    let tracked!: Promise<void>;
    tracked = operation.finally(() => {
      if (this.#activeTask === tracked) this.#activeTask = undefined;
    });
    this.#activeTask = tracked;
    void tracked.catch(() => {});
  }

  async #executeTask(text: string): Promise<void> {
    this.#output.onRecord({ status: "RUNNING" });
    try {
      const result = await this.#runtime.runTask(text);
      if (result.outcome === "completed") {
        this.#output.onRecord({ status: "COMPLETED", saved: result.saved });
        this.#output.onAnswer(result.answer);
      } else if (result.outcome === "cancelled") {
        this.#output.onRecord({ status: "CANCELLED" });
      } else {
        this.#output.onRecord({
          status: "FAILED",
          stage: result.stage,
          errorKind: result.errorKind,
        });
      }
    } catch (error) {
      this.#output.onRecord(failureRecord("PROMPT", error));
    } finally {
      if (!this.#quitting && !this.#closed) this.#output.onRecord(this.#readyRecord());
    }
  }

  #readyRecord(): ConsoleRecord {
    if (!this.#readyInfo) throw new Error("Task console ready information is unavailable");
    return {
      status: "READY",
      session: this.#readyInfo.session,
      model: this.#readyInfo.model,
      tools: [...this.#readyInfo.tools],
    };
  }

  #quit(): Promise<"QUIT"> {
    if (this.#quitPromise) return this.#quitPromise;
    this.#quitting = true;
    this.#quitPromise = this.#performQuit();
    return this.#quitPromise;
  }

  async #performQuit(): Promise<"QUIT"> {
    let cleanupFailed = false;
    if (this.#activeTask) {
      try {
        await this.#runtime.cancel();
      } catch {
        cleanupFailed = true;
      }
      try {
        await this.#activeTask;
      } catch {
        cleanupFailed = true;
      }
    }

    try {
      this.#unsubscribe?.();
    } catch {
      cleanupFailed = true;
    }
    this.#unsubscribe = undefined;
    try {
      await this.#runtime.close();
    } catch {
      cleanupFailed = true;
    } finally {
      this.#closed = true;
      this.#started = false;
    }

    if (cleanupFailed) throw shutdownFailure();
    return "QUIT";
  }

  async #closeRuntimeAfterStartupFailure(): Promise<boolean> {
    let cleanupFailed = false;
    try {
      this.#unsubscribe?.();
    } catch {
      cleanupFailed = true;
    }
    this.#unsubscribe = undefined;
    try {
      await this.#runtime.close();
    } catch {
      cleanupFailed = true;
    }
    return cleanupFailed;
  }
}
