import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const labRoot = path.resolve(testDir, "..");
const runner = path.join(labRoot, "scripts/run-git-source-lab.mjs");

test("Git 分支移动、temporary 缓存与完整 Commit 分别保持准确边界", () => {
  const result = spawnSync(process.execPath, [runner, "--json"], {
    cwd: labRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      TERM: "dumb",
    },
    timeout: 60_000,
  });

  assert.equal(
    result.status,
    0,
    `Git source lab failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );

  const report = JSON.parse(result.stdout);
  assert.equal(report.network, "loopback-only");
  assert.equal(report.host, "127.0.0.1");
  assert.equal(report.branchRef, "main");
  assert.match(report.commitA, /^[0-9a-f]{40}$/);
  assert.match(report.commitB, /^[0-9a-f]{40}$/);
  assert.notEqual(report.commitA, report.commitB);
  assert.deepEqual(report.observations, {
    branchBeforeMove: "A",
    cachedBranchAfterMove: "A",
    freshBranchAfterMove: "B",
    commitAAfterBranchMove: "A",
  });
  assert.equal(report.result, "PASS");
});
