import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const labRoot = path.resolve(testDir, "..");
const runner = path.join(labRoot, "scripts/run-package-security-lab.mjs");

test("Package 安装脚本、rebuild 与 Extension 过滤保持四条独立控制链", () => {
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
    `Package security lab failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );

  const report = JSON.parse(result.stdout);
  assert.equal(report.network, "loopback-only");
  assert.equal(report.host, "127.0.0.1");
  assert.equal(report.packageName, "pi-study-package-security-lab");
  assert.equal(report.version, "1.0.0");
  assert.deepEqual(report.staticAudit, {
    tarballFiles: [
      "extensions/load-marker.js",
      "package.json",
      "scripts/postinstall.mjs",
    ],
    dependencies: [],
    peerDependencies: [],
    bundledDependencies: [],
    devDependencies: [],
    lifecycleScripts: ["postinstall"],
    extensionEntries: ["./extensions/load-marker.js"],
  });
  assert.deepEqual(report.observations, {
    A: {
      installMarker: true,
      loadBeforeStart: 0,
      loadAfterStart: 1,
    },
    B: {
      installMarker: false,
      loadBeforeStart: 0,
      loadAfterStart: 1,
    },
    C: {
      installMarker: true,
      loadBeforeRebuild: 1,
      loadAfterRebuild: 1,
    },
    D: {
      installMarker: true,
      loadBeforeDisabledStart: 1,
      loadAfterDisabledStart: 1,
    },
  });
  assert.ok(report.registryRequests > 0);
  assert.equal(report.result, "PASS");
});
