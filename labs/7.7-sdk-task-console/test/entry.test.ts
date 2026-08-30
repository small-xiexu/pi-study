import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import test from "node:test";

import { runSmoke } from "../task-console.ts";
import type { ConsoleRecord } from "../safe-output.ts";

interface FixtureExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  waitForText(text: string, timeoutMs?: number): Promise<void>;
  waitForExit(timeoutMs?: number): Promise<FixtureExit>;
}

function startFixture(mode: string, shutdownGraceMs = 5_000): FixtureHandle {
  const labDirectory = path.resolve(import.meta.dirname, "..");
  const child = spawn(process.execPath, ["test/entry-fixture.ts"], {
    cwd: labDirectory,
    env: {
      ...process.env,
      PI_STUDY_78_FIXTURE_MODE: mode,
      PI_STUDY_78_SHUTDOWN_GRACE_MS: String(shutdownGraceMs),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  const textWaiters = new Set<{
    text: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  const flushTextWaiters = (): void => {
    const combined = `${stdout}${stderr}`;
    for (const waiter of [...textWaiters]) {
      if (!combined.includes(waiter.text)) continue;
      clearTimeout(waiter.timer);
      textWaiters.delete(waiter);
      waiter.resolve();
    }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    flushTextWaiters();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    flushTextWaiters();
  });

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        for (const waiter of [...textWaiters]) {
          clearTimeout(waiter.timer);
          textWaiters.delete(waiter);
          waiter.reject(new Error(`fixture exited before ${waiter.text}: ${stdout}${stderr}`));
        }
        resolve({ code, signal });
      });
    },
  );

  return {
    child,
    waitForText(text: string, timeoutMs = 3_000): Promise<void> {
      if (`${stdout}${stderr}`.includes(text)) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const waiter = {
          text,
          resolve,
          reject,
          timer: setTimeout(() => {
            textWaiters.delete(waiter);
            reject(new Error(`timed out waiting for ${text}: ${stdout}${stderr}`));
          }, timeoutMs),
        };
        textWaiters.add(waiter);
      });
    },
    async waitForExit(timeoutMs = 3_000): Promise<FixtureExit> {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`fixture did not exit: ${stdout}${stderr}`));
        }, timeoutMs);
      });
      try {
        const result = await Promise.race([exit, timeout]);
        return { ...result, stdout, stderr };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

test("reports an unsafe SessionDir once without leaking its path", async () => {
  const labDirectory = path.resolve(import.meta.dirname, "..");
  const forbiddenDirectory = await mkdtemp(
    path.join(labDirectory, ".forbidden-test-session-"),
  );

  try {
    const result = spawnSync(process.execPath, ["task-console.ts"], {
      cwd: labDirectory,
      env: { ...process.env, PI_STUDY_77_SESSION_DIR: forbiddenDirectory },
      encoding: "utf8",
      input: "",
      timeout: 10_000,
    });
    const combined = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1);
    assert.equal((combined.match(/status=FAILED/gu) ?? []).length, 1);
    assert.equal(
      combined.includes("status=FAILED stage=STARTUP errorKind=SessionDirectoryContractViolation"),
      true,
    );
    assert.equal(combined.includes(forbiddenDirectory), false);
    assert.equal(combined.includes(labDirectory), false);
  } finally {
    await rm(forbiddenDirectory, { recursive: true, force: true });
  }
});

test("hard-stops smoke even when controller startup never resolves", async () => {
  const never = new Promise<never>(() => {});
  const commands: string[] = [];
  let resolveHardExit!: (code: number) => void;
  const hardExit = new Promise<number>((resolve) => {
    resolveHardExit = resolve;
  });

  void runSmoke({
    timeoutMs: 5,
    cancelGraceMs: 5,
    createController: () => ({
      start: () => never,
      handleLine: async (line: string) => {
        commands.push(line);
        return "NO_ACTIVE_TASK";
      },
      waitForIdle: () => never,
    }),
    emitRecord: () => {},
    hardExit: (code: number) => resolveHardExit(code),
  });

  let guardTimer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    guardTimer = setTimeout(() => reject(new Error("smoke hard exit did not fire")), 1_000);
  });
  const exitCode = await Promise.race([hardExit, guard]);
  if (guardTimer) clearTimeout(guardTimer);

  assert.equal(exitCode, 1);
  assert.deepEqual(commands, ["/cancel"]);
});

test("does not start the smoke task when startup finishes after soft timeout", async () => {
  let resolveStart!: () => void;
  const delayedStart = new Promise<void>((resolve) => {
    resolveStart = resolve;
  });
  const commands: string[] = [];
  const exitCodes: number[] = [];
  let hardExitCalled = false;

  const smoke = runSmoke({
    timeoutMs: 5,
    cancelGraceMs: 1_000,
    createController: () => ({
      start: () => delayedStart,
      handleLine: async (line: string) => {
        commands.push(line);
        return line === "/quit" ? "QUIT" : "NO_ACTIVE_TASK";
      },
      waitForIdle: async () => {
        throw new Error("late smoke task must not start");
      },
    }),
    emitRecord: () => {},
    hardExit: () => {
      hardExitCalled = true;
    },
    setExitCode: (code: number) => exitCodes.push(code),
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  resolveStart();
  await smoke;

  assert.deepEqual(commands, ["/cancel", "/quit"]);
  assert.equal(hardExitCalled, false);
  assert.deepEqual(exitCodes, [1]);
});

test("frames CRLF and LF as logical lines and closes exactly once on EOF", () => {
  const labDirectory = path.resolve(import.meta.dirname, "..");
  const result = spawnSync(process.execPath, ["test/entry-fixture.ts"], {
    cwd: labDirectory,
    env: { ...process.env, PI_STUDY_78_FIXTURE_MODE: "lines" },
    encoding: "utf8",
    input: "first\r\nsecond\n",
    timeout: 5_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr.includes('fixture=line:"first"'), true);
  assert.equal(result.stderr.includes('fixture=line:"second"'), true);
  assert.equal(result.stderr.includes("\\r"), false);
  assert.equal((result.stderr.match(/fixture=quit-start/gu) ?? []).length, 1);
  assert.equal((result.stderr.match(/fixture=quit-end/gu) ?? []).length, 1);
});

test("delivers an unterminated final line before EOF cleanup", () => {
  const labDirectory = path.resolve(import.meta.dirname, "..");
  const result = spawnSync(process.execPath, ["test/entry-fixture.ts"], {
    cwd: labDirectory,
    env: { ...process.env, PI_STUDY_78_FIXTURE_MODE: "lines" },
    encoding: "utf8",
    input: "tail-without-newline",
    timeout: 5_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes('fixture=line:"tail-without-newline"'), true);
  assert.equal((result.stderr.match(/fixture=quit-start/gu) ?? []).length, 1);
});

test("waits for an active task cleanup after EOF", () => {
  const labDirectory = path.resolve(import.meta.dirname, "..");
  const result = spawnSync(process.execPath, ["test/entry-fixture.ts"], {
    cwd: labDirectory,
    env: { ...process.env, PI_STUDY_78_FIXTURE_MODE: "active-eof" },
    encoding: "utf8",
    input: "active task\n",
    timeout: 5_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes('fixture=line:"active task"'), true);
  assert.equal(result.stderr.includes("fixture=active-finished"), true);
  assert.equal((result.stderr.match(/fixture=quit-end/gu) ?? []).length, 1);
});

test("waits for delayed startup before SIGTERM cleanup", async () => {
  const fixture = startFixture("delayed-start");
  await fixture.waitForText("fixture=STARTING");
  assert.equal(fixture.child.kill("SIGTERM"), true);

  const result = await fixture.waitForExit();

  assert.equal(result.code, 143, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr.includes("fixture=READY"), true);
  assert.equal((result.stderr.match(/fixture=quit-start/gu) ?? []).length, 1);
  assert.equal((result.stderr.match(/fixture=quit-end/gu) ?? []).length, 1);
});

test("bounds SIGINT cleanup while startup never settles", async () => {
  const fixture = startFixture("hang-start", 50);
  await fixture.waitForText("fixture=STARTING");
  assert.equal(fixture.child.kill("SIGINT"), true);

  const result = await fixture.waitForExit();

  assert.equal(result.code, 130, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr.includes("fixture=quit-start"), false);
  assert.equal(
    result.stderr.includes("status=FAILED stage=SHUTDOWN errorKind=ShutdownTimeout"),
    true,
  );
});

for (const [signal, expectedCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(`cleans up once and preserves exit ${expectedCode} for ${signal}`, async () => {
    const fixture = startFixture("signal");
    await fixture.waitForText("fixture=READY");
    assert.equal(fixture.child.kill(signal), true);

    const result = await fixture.waitForExit();

    assert.equal(result.code, expectedCode, result.stderr);
    assert.equal(result.signal, null);
    assert.equal((result.stderr.match(/fixture=quit-start/gu) ?? []).length, 1);
    assert.equal((result.stderr.match(/fixture=quit-end/gu) ?? []).length, 1);
  });
}

test("hard-exits with the first signal code when graceful shutdown times out", async () => {
  const fixture = startFixture("hang", 50);
  await fixture.waitForText("fixture=READY");
  assert.equal(fixture.child.kill("SIGTERM"), true);
  await fixture.waitForText("fixture=quit-start:1");

  const result = await fixture.waitForExit();

  assert.equal(result.code, 143, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(
    result.stderr.includes("status=FAILED stage=SHUTDOWN errorKind=ShutdownTimeout"),
    true,
  );
});

test("hard-exits on a repeated signal without starting cleanup twice", async () => {
  const fixture = startFixture("hang");
  await fixture.waitForText("fixture=READY");
  assert.equal(fixture.child.kill("SIGINT"), true);
  await fixture.waitForText("fixture=quit-start:1");
  assert.equal(fixture.child.kill("SIGINT"), true);

  const result = await fixture.waitForExit();

  assert.equal(result.code, 130, result.stderr);
  assert.equal(result.signal, null);
  assert.equal((result.stderr.match(/fixture=quit-start/gu) ?? []).length, 1);
  assert.equal(result.stderr.includes("ShutdownTimeout"), false);
});

test("treats stdout EPIPE as a sanitized nonzero shutdown", async () => {
  const fixture = startFixture("epipe");
  await fixture.waitForText("fixture=READY");
  fixture.child.stdout.destroy();

  const result = await fixture.waitForExit();

  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(
    result.stderr.includes("status=FAILED stage=SHUTDOWN errorKind=BrokenPipe"),
    true,
  );
  assert.equal((result.stderr.match(/fixture=quit-start/gu) ?? []).length, 1);
});

test("reports a shutdown failure once without leaking its message", () => {
  const labDirectory = path.resolve(import.meta.dirname, "..");
  const result = spawnSync(process.execPath, ["test/entry-fixture.ts"], {
    cwd: labDirectory,
    env: { ...process.env, PI_STUDY_78_FIXTURE_MODE: "shutdown-fail" },
    encoding: "utf8",
    input: "",
    timeout: 5_000,
  });

  assert.equal(result.status, 1, result.stderr);
  assert.equal(
    (result.stderr.match(/status=FAILED stage=SHUTDOWN errorKind=ShutdownFailure/gu) ?? [])
      .length,
    1,
  );
  assert.equal(result.stderr.includes("private shutdown detail"), false);
  assert.equal(result.stderr.includes("UNEXPECTED_REJECTION"), false);
});

test("classifies a smoke quit failure as SHUTDOWN without rejecting", async () => {
  const records: ConsoleRecord[] = [];
  const exitCodes: number[] = [];

  await runSmoke({
    createController: () => ({
      async start(): Promise<void> {},
      async handleLine(line: string): Promise<unknown> {
        if (line === "/quit") throw new Error("private smoke cleanup detail");
        return "STARTED";
      },
      async waitForIdle(): Promise<void> {},
    }),
    emitRecord: (record) => records.push(record),
    setExitCode: (code) => exitCodes.push(code),
  });

  assert.deepEqual(records, [
    { status: "FAILED", stage: "SHUTDOWN", errorKind: "ShutdownFailure" },
  ]);
  assert.deepEqual(exitCodes, [1]);
});
