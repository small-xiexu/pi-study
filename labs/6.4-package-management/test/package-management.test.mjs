import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const labRoot = path.resolve(testDir, "..");
const runner = path.join(labRoot, "scripts/run-package-management-lab.mjs");

const allResources = {
  extensionFlag: 1,
  extensionCommand: 1,
  skill: 1,
  prompt: 1,
  theme: 1,
  diagnostics: 0,
};

const extensionDisabled = {
  ...allResources,
  extensionFlag: 0,
  extensionCommand: 0,
};

const noResources = {
  extensionFlag: 0,
  extensionCommand: 0,
  skill: 0,
  prompt: 0,
  theme: 0,
  diagnostics: 0,
};

test("Package 管理分别验证 Settings、安装内容、筛选、更新、移除与重装", { timeout: 240_000 }, () => {
  const result = spawnSync(process.execPath, [runner, "--json"], {
    cwd: path.resolve(labRoot, "../.."),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      NO_COLOR: "1",
      TERM: "dumb",
    },
    timeout: 210_000,
  });

  assert.equal(
    result.status,
    0,
    `Package management lab failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );

  const report = JSON.parse(result.stdout);
  assert.equal(report.network, "loopback-only");
  assert.equal(report.host, "127.0.0.1");
  assert.equal(report.piVersion, "0.84.2");
  assert.equal(report.packageName, "pi-study-workbench");
  assert.deepEqual(report.versions, { A: "0.1.0", B: "0.1.1" });
  assert.equal(report.source, "npm:pi-study-workbench@^0.1.0");
  assert.deepEqual(report.tarballFiles, { A: 19, B: 19 });
  assert.match(report.tarballSha256.A, /^[a-f0-9]{64}$/);
  assert.match(report.tarballSha256.B, /^[a-f0-9]{64}$/);
  assert.notEqual(report.tarballSha256.A, report.tarballSha256.B);

  assert.deepEqual(report.observations.baseline, {
    userConfigured: false,
    projectConfigured: false,
    userInstalled: false,
    projectInstalled: false,
    resources: noResources,
  });
  assert.deepEqual(report.observations.userInstallA, {
    listUser: 1,
    listProject: 0,
    userConfigured: true,
    projectConfigured: false,
    userInstalled: true,
    projectInstalled: false,
    installedVersion: "0.1.0",
    resources: allResources,
  });
  assert.deepEqual(report.observations.projectInstallA, {
    listUser: 1,
    listProject: 1,
    userInstalled: true,
    projectInstalled: true,
    resources: allResources,
  });
  assert.deepEqual(report.observations.ordinaryEmpty, {
    filter: { extensions: [] },
    resources: extensionDisabled,
  });
  assert.deepEqual(report.observations.ordinaryPrecedence, {
    excluded: extensionDisabled,
    forceIncluded: allResources,
    forceExcluded: extensionDisabled,
  });
  assert.deepEqual(report.observations.projectDeltaEmpty, {
    autoload: false,
    projectInstalled: false,
    resources: allResources,
  });
  assert.deepEqual(report.observations.projectDeltaDisabled, {
    autoload: false,
    projectInstalled: false,
    resources: extensionDisabled,
  });
  assert.deepEqual(report.observations.updatedB, {
    configuredSource: "npm:pi-study-workbench@^0.1.0",
    installedVersion: "0.1.1",
    resources: allResources,
  });
  assert.deepEqual(report.observations.projectDeltaAfterUpdate, {
    installedVersion: "0.1.1",
    resources: extensionDisabled,
  });
  assert.deepEqual(report.observations.projectRemoved, {
    listUser: 1,
    listProject: 0,
    userConfigured: true,
    projectConfigured: false,
    userInstalled: true,
    projectInstalled: false,
    resources: allResources,
  });
  assert.deepEqual(report.observations.userRemoved, {
    listUser: 0,
    listProject: 0,
    userConfigured: false,
    projectConfigured: false,
    userInstalled: false,
    projectInstalled: false,
    resources: noResources,
  });
  assert.deepEqual(report.observations.reinstalledB, {
    listUser: 1,
    listProject: 0,
    userConfigured: true,
    userInstalled: true,
    installedVersion: "0.1.1",
    resources: allResources,
  });
  assert.ok(report.registryRequests > 0);
  assert.equal(report.tempResiduals, 0);
  assert.equal(report.result, "PASS");
});

test("guided 模式只准备隔离环境并在退出后清理", { timeout: 30_000 }, async () => {
  const child = spawn(process.execPath, [runner, "--guided"], {
    cwd: path.resolve(labRoot, "../.."),
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      NO_COLOR: "1",
      TERM: "dumb",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let ready = false;
  const readinessTimeout = setTimeout(() => child.kill("SIGTERM"), 10_000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (!ready && stdout.includes("guided_status=READY")) {
      ready = true;
      child.stdin.end("publish-b\nquit\n");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(readinessTimeout);

  assert.equal(
    exit.code,
    0,
    `guided lab failed with ${exit.code ?? exit.signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
  );
  assert.equal(ready, true, `guided lab never became ready\nstdout:\n${stdout}`);
  assert.match(stdout, /^network=loopback-only$/m);
  assert.match(stdout, /^host=127\.0\.0\.1$/m);
  assert.match(stdout, /^pi_version=0\.84\.2$/m);
  assert.match(stdout, /^source=npm:pi-study-workbench@\^0\.1\.0$/m);
  assert.match(stdout, /^guided_registry=A$/m);
  assert.match(stdout, /^guided_registry=B$/m);
  assert.match(stdout, /^baseline_user_settings=0$/m);
  assert.match(stdout, /^baseline_project_settings=0$/m);
  assert.match(stdout, /^baseline_user_install=0$/m);
  assert.match(stdout, /^baseline_project_install=0$/m);
  assert.match(stdout, /^registry_requests=0$/m);
  assert.match(stdout, /^management_commands=0$/m);
  assert.match(stdout, /^guided_stop_reason=quit$/m);
  assert.match(stdout, /^final_registry_requests=0$/m);
  assert.match(stdout, /^guided_status=STOPPED$/m);
  assert.match(stdout, /^temp_residuals=0$/m);

  const tempRoot = stdout.match(/^temp_root=(.+)$/m)?.[1];
  const envFile = stdout.match(/^env_file=(.+)$/m)?.[1];
  assert.ok(tempRoot, "guided output did not expose temp_root");
  assert.ok(envFile, "guided output did not expose env_file");
  await assert.rejects(access(tempRoot), { code: "ENOENT" });
  await assert.rejects(access(envFile), { code: "ENOENT" });
});
