import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const runner = path.resolve(testDir, "../scripts/run-package-artifact-lab.mjs");

test("源码根与实际 tarball 解包根发现同一组 Package 资源", { timeout: 120_000 }, () => {
  const result = spawnSync(process.execPath, [runner], {
    cwd: path.resolve(testDir, "../../.."),
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      NO_COLOR: "1",
      TERM: "dumb",
    },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, output);

  for (const marker of [
    "network=offline",
    "package=pi-study-workbench@0.1.0",
    "license=UNLICENSED",
    "publish_dry_run=true",
    "source_extension_flag=1",
    "source_extension_command=1",
    "source_skill=1",
    "source_prompt=1",
    "source_theme=1",
    "archive_extension_flag=1",
    "archive_extension_command=1",
    "archive_skill=1",
    "archive_prompt=1",
    "archive_theme=1",
    "diagnostics=0",
    "temp_residuals=0",
    "result=PASS",
  ]) {
    assert.match(output, new RegExp(`^${marker}$`, "m"), output);
  }

  assert.match(output, /^tarball_sha256=[a-f0-9]{64}$/m, output);
  assert.match(output, /^tarball_files=\d+$/m, output);
});
