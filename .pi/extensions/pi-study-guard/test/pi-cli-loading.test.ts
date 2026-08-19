import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { GUARD_FLAG } from "../index.ts";

const PI_CLI_PATH = fileURLToPath(
  new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
);
const EXTENSION_PATH = fileURLToPath(new URL("../index.ts", import.meta.url));

function runHelp(
  cwd: string,
  home: string,
  piCodingAgentDir: string,
  loadExtension: boolean,
): SpawnSyncReturns<string> {
  const args = [PI_CLI_PATH];
  if (loadExtension) args.push("-e", EXTENSION_PATH);
  args.push("--help");

  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: {
      HOME: home,
      PI_CODING_AGENT_DIR: piCodingAgentDir,
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      TERM: "dumb",
      NO_COLOR: "1",
    },
    timeout: 15_000,
    windowsHide: true,
  });
}

function assertSuccessfulHelp(result: SpawnSyncReturns<string>, label: string): void {
  assert.equal(result.error, undefined, `${label} failed to start: ${result.error?.message}`);
  assert.equal(result.signal, null, `${label} terminated by signal ${result.signal}`);
  assert.equal(
    result.status,
    0,
    `${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function countFlag(output: string): number {
  return output.split(`--${GUARD_FLAG}`).length - 1;
}

test("the pinned real Pi CLI exposes the guard flag only when the Extension is loaded", {
  timeout: 30_000,
}, () => {
  const root = mkdtempSync(join(tmpdir(), "pi-study-cli-loading-"));
  const home = join(root, "home");
  const piCodingAgentDir = join(root, "pi");
  const cwd = join(root, "work");
  mkdirSync(home);
  mkdirSync(piCodingAgentDir);
  mkdirSync(cwd);

  try {
    const control = runHelp(cwd, home, piCodingAgentDir, false);
    assertSuccessfulHelp(control, "control Pi --help");
    assert.equal(countFlag(control.stdout), 0);

    const loaded = runHelp(cwd, home, piCodingAgentDir, true);
    assertSuccessfulHelp(loaded, "Extension-loaded Pi --help");
    assert.equal(countFlag(loaded.stdout), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
