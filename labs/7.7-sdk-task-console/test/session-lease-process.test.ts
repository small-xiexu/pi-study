import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SESSION_LEASE_FILE } from "../task-console-runtime.ts";

test("rejects a real second writer and releases the lease for the next process", async () => {
  const labDirectory = path.resolve(import.meta.dirname, "..");
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-lease-process-"));
  const sessionDirectory = path.join(root, "private-sessions");
  const environment = {
    ...process.env,
    PI_STUDY_78_LEASE_DIR: sessionDirectory,
  };
  const first = spawn(process.execPath, ["test/session-lease-fixture.ts"], {
    cwd: labDirectory,
    env: environment,
    stdio: ["pipe", "ignore", "pipe"],
  });
  let firstStderr = "";
  let readyTimer: NodeJS.Timeout | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      readyTimer = setTimeout(() => reject(new Error(`lease holder did not start: ${firstStderr}`)), 3_000);
      first.once("error", reject);
      first.once("exit", (code, signal) => {
        reject(new Error(`lease holder exited early code=${String(code)} signal=${String(signal)}: ${firstStderr}`));
      });
      first.stderr.on("data", (chunk: Buffer) => {
        firstStderr += chunk.toString("utf8");
        if (!firstStderr.includes("fixture=LEASED")) return;
        if (readyTimer) clearTimeout(readyTimer);
        readyTimer = undefined;
        resolve();
      });
    });

    const second = spawnSync(process.execPath, ["test/session-lease-fixture.ts"], {
      cwd: labDirectory,
      env: environment,
      encoding: "utf8",
      input: "",
      timeout: 5_000,
    });
    assert.equal(second.status, 1, second.stderr);
    assert.equal(second.signal, null);
    assert.equal(second.stderr.includes("errorKind=SessionDirectoryBusy"), true);

    const firstExitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          first.kill("SIGKILL");
          reject(new Error(`lease holder did not exit: ${firstStderr}`));
        }, 3_000);
        first.once("exit", (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      },
    );
    first.stdin.end();
    const firstExit = await firstExitPromise;
    assert.deepEqual(firstExit, { code: 0, signal: null });
    assert.equal(firstStderr.includes("fixture=RELEASED"), true);
    await assert.rejects(stat(path.join(sessionDirectory, SESSION_LEASE_FILE)), {
      code: "ENOENT",
    });

    const third = spawnSync(process.execPath, ["test/session-lease-fixture.ts"], {
      cwd: labDirectory,
      env: environment,
      encoding: "utf8",
      input: "",
      timeout: 5_000,
    });
    assert.equal(third.status, 0, third.stderr);
    assert.equal(third.stderr.includes("fixture=LEASED"), true);
    assert.equal(third.stderr.includes("fixture=RELEASED"), true);
  } finally {
    if (readyTimer) clearTimeout(readyTimer);
    if (first.exitCode === null && first.signalCode === null) first.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});
