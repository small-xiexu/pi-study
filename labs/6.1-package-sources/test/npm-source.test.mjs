import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const labRoot = path.resolve(testDir, "..");
const runner = path.join(labRoot, "scripts/run-npm-source-lab.mjs");

test("npm 精确版本保持 A，版本范围在显式更新后从 A 解析到 B", () => {
  const result = spawnSync(process.execPath, [runner, "--json"], {
    cwd: labRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      TERM: "dumb",
    },
    timeout: 120_000,
  });

  assert.equal(
    result.status,
    0,
    `npm source lab failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );

  const report = JSON.parse(result.stdout);
  assert.equal(report.network, "loopback-only");
  assert.equal(report.host, "127.0.0.1");
  assert.equal(report.packageName, "pi-study-npm-source-lab");
  assert.deepEqual(report.versions, { A: "1.0.0", B: "1.1.0" });
  assert.deepEqual(report.sources, {
    exact: "npm:pi-study-npm-source-lab@1.0.0",
    range: "npm:pi-study-npm-source-lab@^1.0.0",
  });
  assert.deepEqual(report.observations, {
    exactBeforeUpdate: { marker: "A", version: "1.0.0" },
    rangeBeforeUpdate: { marker: "A", version: "1.0.0" },
    exactAfterUpdate: { marker: "A", version: "1.0.0" },
    rangeAfterUpdate: { marker: "B", version: "1.1.0" },
  });
  assert.equal(report.result, "PASS");
});
