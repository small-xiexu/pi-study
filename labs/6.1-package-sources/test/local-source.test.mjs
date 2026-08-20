import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const labRoot = path.resolve(testDir, "..");
const sourcePackage = path.join(labRoot, "local-package");
const switchScript = path.join(labRoot, "scripts/switch-local-marker.mjs");

function run(command, args, options) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
}

function assertSuccessful(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function runPi(packageRoot, agentDir, projectDir) {
  const result = run(
    process.env.PI_BIN ?? "pi",
    [
      "-e",
      packageRoot,
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-tools",
      "--help",
    ],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1",
        NO_COLOR: "1",
        TERM: "dumb",
      },
    },
  );
  assertSuccessful(result, "pi --help");
  return `${result.stdout}\n${result.stderr}`;
}

test("同一本地 Package 路径在新进程中从 A 原地切换到 B", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-study-6.1-local-"));
  const packageRoot = path.join(tempRoot, "package");
  const agentDir = path.join(tempRoot, "agent");
  const projectDir = path.join(tempRoot, "project");

  try {
    await cp(sourcePackage, packageRoot, { recursive: true });
    await mkdir(agentDir, { recursive: true, mode: 0o700 });
    await mkdir(projectDir, { recursive: true, mode: 0o700 });

    const outputA = runPi(packageRoot, agentDir, projectDir);
    assert.match(outputA, /PI_STUDY_PACKAGE_A/);
    assert.doesNotMatch(outputA, /PI_STUDY_PACKAGE_B/);

    const switchResult = run(process.execPath, [switchScript, "B", packageRoot]);
    assertSuccessful(switchResult, "switch marker to B");

    const extension = await readFile(
      path.join(packageRoot, "extensions/source-marker.js"),
      "utf8",
    );
    assert.match(extension, /PI_STUDY_PACKAGE_B/);
    assert.doesNotMatch(extension, /PI_STUDY_PACKAGE_A/);

    const outputB = runPi(packageRoot, agentDir, projectDir);
    assert.match(outputB, /PI_STUDY_PACKAGE_B/);
    assert.doesNotMatch(outputB, /PI_STUDY_PACKAGE_A/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
