import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CAPSTONE_COMMANDS,
  PASS_STAGES,
  REQUIRED_FILES,
  runCapstoneCheck,
  runCapstoneCli,
} from "../run-capstone-check.mjs";

const EXPECTED_COMMANDS = [
  {
    stage: "extension",
    command: "npm",
    args: ["--prefix", ".pi/extensions/pi-study-guard", "run", "check"],
  },
  {
    stage: "package-artifact",
    command: "node",
    args: ["labs/6.3-local-package/scripts/run-package-artifact-lab.mjs"],
  },
  {
    stage: "sdk-task-console",
    command: "npm",
    args: ["--prefix", "labs/7.7-sdk-task-console", "run", "check"],
  },
];

const REQUIRED_LOCK_FILES = [
  ".pi/extensions/pi-study-guard/package-lock.json",
  "labs/7.1-sdk/package-lock.json",
  "labs/7.7-sdk-task-console/package-lock.json",
];

const REQUIRED_CRITICAL_FILES = [
  "labs/7.1-sdk/package.json",
  "labs/7.7-sdk-task-console/test/read-path-gate.test.ts",
  "labs/8.8-capstone/test/run-capstone-check.test.mjs",
];

const LOCK_CONTRACTS = {
  ".pi/extensions/pi-study-guard/package-lock.json": {
    name: "pi-study-guard",
    version: "0.0.0",
    dependencySection: "devDependencies",
    dependencies: {
      "@earendil-works/pi-coding-agent": "0.84.1",
      "@earendil-works/pi-tui": "0.84.1",
    },
  },
  "labs/7.1-sdk/package-lock.json": {
    name: "pi-study-sdk-7-1",
    version: "0.0.0",
    dependencySection: "dependencies",
    dependencies: {
      "@earendil-works/pi-coding-agent": "0.84.2",
    },
  },
  "labs/7.7-sdk-task-console/package-lock.json": {
    name: "pi-study-sdk-task-console-7-7",
    version: "0.0.0",
    dependencySection: "dependencies",
    dependencies: {
      "@earendil-works/pi-ai": "0.84.3",
      "@earendil-works/pi-coding-agent": "0.84.3",
    },
  },
};

const CAPSTONE_SCRIPT = "node labs/8.8-capstone/run-capstone-check.mjs";

function resolvedPackageEntries(contract, overrides = {}) {
  return Object.fromEntries(
    Object.entries(contract.dependencies).map(([name, version]) => [
      `node_modules/${name}`,
      { version: overrides[name] ?? version },
    ]),
  );
}

function requiredContent(relativePath) {
  if (relativePath === "package.json") {
    return `${JSON.stringify({ scripts: { "capstone:check": CAPSTONE_SCRIPT } })}\n`;
  }
  const lockContract = LOCK_CONTRACTS[relativePath];
  if (lockContract) {
    return `${JSON.stringify({
      name: lockContract.name,
      version: lockContract.version,
      lockfileVersion: 3,
      packages: {
        "": {
          name: lockContract.name,
          version: lockContract.version,
          [lockContract.dependencySection]: lockContract.dependencies,
        },
        ...resolvedPackageEntries(lockContract),
      },
    })}\n`;
  }
  if (relativePath === ".pi/extensions/pi-study-guard/package.json") {
    return `${JSON.stringify({
      name: "pi-study-guard",
      version: "0.0.0",
      devDependencies: {
        "@earendil-works/pi-coding-agent": "0.84.1",
        "@earendil-works/pi-tui": "0.84.1",
      },
    })}\n`;
  }
  if (relativePath === "labs/7.1-sdk/package.json") {
    return `${JSON.stringify({
      name: "pi-study-sdk-7-1",
      version: "0.0.0",
      dependencies: { "@earendil-works/pi-coding-agent": "0.84.2" },
    })}\n`;
  }
  if (relativePath === "labs/7.7-sdk-task-console/package.json") {
    return `${JSON.stringify({
      name: "pi-study-sdk-task-console-7-7",
      version: "0.0.0",
      dependencies: {
        "@earendil-works/pi-ai": "0.84.3",
        "@earendil-works/pi-coding-agent": "0.84.3",
      },
    })}\n`;
  }
  if (relativePath === "docs/learning/README.md") {
    return [
      "# Pi 学习资料索引",
      "",
      "[09-source-and-capstone.md](09-source-and-capstone.md)",
      "",
    ].join("\n");
  }
  if (relativePath === "docs/learning/09-source-and-capstone.md") {
    return [
      "# Pi 源码核心逻辑与综合项目",
      "",
      "## 当前证据边界",
      "",
      "仅覆盖离线验收。",
      "",
    ].join("\n");
  }
  if (relativePath === "labs/8.8-capstone/README.md") {
    return [
      "# 8.8 毕业项目",
      "",
      "`node labs/8.8-capstone/run-capstone-check.mjs`",
      "",
    ].join("\n");
  }
  return "fixture\n";
}

async function createFixtureRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "pi-study-capstone-test-"));
  const controlledFiles = [
    ...REQUIRED_FILES,
    ...REQUIRED_LOCK_FILES,
    ...REQUIRED_CRITICAL_FILES,
    ".pi/settings.json",
    ".pi/themes/pi-study-lab.json",
    "labs/7.1-sdk/sdk-demo.ts",
  ];
  for (const relativePath of new Set(controlledFiles)) {
    const targetPath = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, requiredContent(relativePath));
  }
  return repoRoot;
}

async function withFixture(run) {
  const repoRoot = await createFixtureRepo();
  try {
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

test("freezes the offline command list without install, smoke, or Provider entrypoints", () => {
  assert.deepEqual(CAPSTONE_COMMANDS, EXPECTED_COMMANDS);
  const commandText = CAPSTONE_COMMANDS.map(
    ({ command, args }) => `${command} ${args.join(" ")}`,
  ).join("\n");
  assert.doesNotMatch(commandText, /\b(?:ci|install|smoke|provider)\b/iu);
  assert.doesNotMatch(commandText, /labs\/7\.[124](?:\/|-)/u);
});

test("requires all three dependency lockfiles", () => {
  for (const relativePath of REQUIRED_LOCK_FILES) {
    assert.equal(REQUIRED_FILES.includes(relativePath), true, relativePath);
  }
});

test("requires the 7.1 manifest and both critical regression tests", () => {
  for (const relativePath of REQUIRED_CRITICAL_FILES) {
    assert.equal(REQUIRED_FILES.includes(relativePath), true, relativePath);
  }
});

test("emits every fixed PASS stage in execution order", async () => {
  await withFixture(async (repoRoot) => {
    const calls = [];
    const output = [];
    await runCapstoneCheck({
      repoRoot,
      runCommand: async ({ stage }) => calls.push(stage),
      emit: (line) => output.push(line),
    });

    assert.deepEqual(calls, EXPECTED_COMMANDS.map(({ stage }) => stage));
    assert.deepEqual(output, [
      ...PASS_STAGES.map((stage) => `stage=${stage} status=PASS`),
      "result=PASS",
    ]);
  });
});

test("stops at a failed subcommand, exits nonzero, and redacts child output", async () => {
  await withFixture(async (repoRoot) => {
    const calls = [];
    const stdout = [];
    const stderr = [];
    const privateDetail = `${repoRoot}/private-session token=do-not-print`;
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async ({ stage }) => {
        calls.push(stage);
        if (stage === "package-artifact") {
          const error = new Error(privateDetail);
          error.stdout = `provider response: ${privateDetail}`;
          error.stderr = `key=${privateDetail}`;
          throw error;
        }
      },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(calls, ["extension", "package-artifact"]);
    assert.deepEqual(stdout, ["stage=extension status=PASS"]);
    assert.deepEqual(stderr, [
      "stage=package-artifact status=FAIL errorKind=SubcommandFailed",
      "result=FAIL",
    ]);
    assert.equal(`${stdout.join("\n")}\n${stderr.join("\n")}`.includes(privateDetail), false);
  });
});

test("fails the required structure stage when a required document is absent", async () => {
  await withFixture(async (repoRoot) => {
    await unlink(path.join(repoRoot, "docs/learning/09-source-and-capstone.md"));
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=required-structure status=FAIL errorKind=RequiredEntryMissing",
      "result=FAIL",
    ]);
  });
});

test("fails the required structure stage when a required lockfile is absent", async () => {
  await withFixture(async (repoRoot) => {
    await unlink(path.join(repoRoot, REQUIRED_LOCK_FILES[1]));
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=required-structure status=FAIL errorKind=RequiredEntryMissing",
      "result=FAIL",
    ]);
  });
});

test("fails the required structure stage when the read path regression test is absent", async () => {
  await withFixture(async (repoRoot) => {
    await unlink(
      path.join(
        repoRoot,
        "labs/7.7-sdk-task-console/test/read-path-gate.test.ts",
      ),
    );
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=required-structure status=FAIL errorKind=RequiredEntryMissing",
      "result=FAIL",
    ]);
  });
});

test("fails with a fixed errorKind when a lockfile is invalid JSON", async () => {
  await withFixture(async (repoRoot) => {
    const privateDetail = "private-lock-detail-must-not-print";
    await writeFile(
      path.join(repoRoot, REQUIRED_LOCK_FILES[0]),
      `{"${privateDetail}":`,
    );
    const stdout = [];
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=required-structure status=FAIL errorKind=LockfileJsonInvalid",
      "result=FAIL",
    ]);
    assert.equal(`${stdout.join("\n")}\n${stderr.join("\n")}`.includes(privateDetail), false);
  });
});

test("fails with a fixed errorKind when a lock dependency version drifts", async () => {
  await withFixture(async (repoRoot) => {
    const lockPath = REQUIRED_LOCK_FILES[2];
    const contract = LOCK_CONTRACTS[lockPath];
    const driftedVersion = "9.9.9-private-drift";
    await writeFile(
      path.join(repoRoot, lockPath),
      `${JSON.stringify({
        name: contract.name,
        version: contract.version,
        lockfileVersion: 3,
        packages: {
          "": {
            name: contract.name,
            version: contract.version,
            dependencies: {
              ...contract.dependencies,
              "@earendil-works/pi-coding-agent": driftedVersion,
            },
          },
          ...resolvedPackageEntries(contract),
        },
      })}\n`,
    );
    const stdout = [];
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=required-structure status=FAIL errorKind=LockfileContractViolation",
      "result=FAIL",
    ]);
    assert.equal(`${stdout.join("\n")}\n${stderr.join("\n")}`.includes(driftedVersion), false);
  });
});

test("fails when a frozen Pi package resolved version drifts", async () => {
  await withFixture(async (repoRoot) => {
    const lockPath = REQUIRED_LOCK_FILES[1];
    const contract = LOCK_CONTRACTS[lockPath];
    const packageName = "@earendil-works/pi-coding-agent";
    const driftedVersion = "9.9.9-resolved-private-drift";
    await writeFile(
      path.join(repoRoot, lockPath),
      `${JSON.stringify({
        name: contract.name,
        version: contract.version,
        lockfileVersion: 3,
        packages: {
          "": {
            name: contract.name,
            version: contract.version,
            [contract.dependencySection]: contract.dependencies,
          },
          ...resolvedPackageEntries(contract, {
            [packageName]: driftedVersion,
          }),
        },
      })}\n`,
    );
    const stdout = [];
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=required-structure status=FAIL errorKind=LockfileContractViolation",
      "result=FAIL",
    ]);
    assert.equal(`${stdout.join("\n")}\n${stderr.join("\n")}`.includes(driftedVersion), false);
  });
});

test("fails the required structure stage when the root capstone alias is absent", async () => {
  await withFixture(async (repoRoot) => {
    await writeFile(path.join(repoRoot, "package.json"), '{"scripts":{}}\n');
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=required-structure status=FAIL errorKind=PackageScriptContractViolation",
      "result=FAIL",
    ]);
  });
});

test("fails the required structure stage when the learning index loses its stable link", async () => {
  await withFixture(async (repoRoot) => {
    await writeFile(
      path.join(repoRoot, "docs/learning/README.md"),
      "# Pi 学习资料索引\n\nmissing stable entry\n",
    );
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=required-structure status=FAIL errorKind=DocumentationContractViolation",
      "result=FAIL",
    ]);
  });
});

test("detects a common credential signature without echoing its value", async () => {
  await withFixture(async (repoRoot) => {
    const fakeCredential = `sk-${"A".repeat(32)}`;
    await writeFile(path.join(repoRoot, "README.md"), `${fakeCredential}\n`);
    const stdout = [];
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=sensitive-patterns status=FAIL errorKind=SensitiveContentDetected",
      "result=FAIL",
    ]);
    assert.equal(`${stdout.join("\n")}\n${stderr.join("\n")}`.includes(fakeCredential), false);
  });
});

test("scans the Theme for credentials without echoing the match", async () => {
  await withFixture(async (repoRoot) => {
    const fakeCredential = `github_pat_${"T".repeat(28)}`;
    await writeFile(
      path.join(repoRoot, ".pi/themes/pi-study-lab.json"),
      `${JSON.stringify({ synthetic: fakeCredential })}\n`,
    );
    const stdout = [];
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=sensitive-patterns status=FAIL errorKind=SensitiveContentDetected",
      "result=FAIL",
    ]);
    assert.equal(`${stdout.join("\n")}\n${stderr.join("\n")}`.includes(fakeCredential), false);
  });
});

test("scans the 7.1 lockfile for credentials without echoing the match", async () => {
  await withFixture(async (repoRoot) => {
    const fakeCredential = `AKIA${"A1".repeat(8)}`;
    const lockPath = "labs/7.1-sdk/package-lock.json";
    const contract = LOCK_CONTRACTS[lockPath];
    await writeFile(
      path.join(repoRoot, lockPath),
      `${JSON.stringify({
        name: contract.name,
        version: contract.version,
        lockfileVersion: 3,
        synthetic: fakeCredential,
        packages: {
          "": {
            name: contract.name,
            version: contract.version,
            [contract.dependencySection]: contract.dependencies,
          },
          ...resolvedPackageEntries(contract),
        },
      })}\n`,
    );
    const stdout = [];
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=sensitive-patterns status=FAIL errorKind=SensitiveContentDetected",
      "result=FAIL",
    ]);
    assert.equal(`${stdout.join("\n")}\n${stderr.join("\n")}`.includes(fakeCredential), false);
  });
});

test("builds a strict child environment without runtime or npm injection", async () => {
  const runner = await import("../run-capstone-check.mjs");
  assert.equal(typeof runner.buildChildEnvironment, "function");
  const environment = runner.buildChildEnvironment({
    PATH: "/controlled/bin",
    TMPDIR: "/controlled/tmp",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PI_BIN: "/controlled/pi",
    NODE_OPTIONS: "--require /private/inject.cjs",
    NODE_PATH: "/private/modules",
    BASH_ENV: "/private/bash-env",
    ENV: "/private/shell-env",
    NPM_CONFIG_SCRIPT_SHELL: "/private/shell",
    npm_config_registry: "https://private.registry.example",
    NPM_CONFIG_CACHE: "/private/cache",
    HOME: "/private/home",
    OPENAI_API_KEY: `sk-${"E".repeat(32)}`,
  });

  assert.deepEqual(
    {
      PATH: environment.PATH,
      TMPDIR: environment.TMPDIR,
      LANG: environment.LANG,
      LC_ALL: environment.LC_ALL,
      PI_BIN: environment.PI_BIN,
    },
    {
      PATH: "/controlled/bin",
      TMPDIR: "/controlled/tmp",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PI_BIN: "/controlled/pi",
    },
  );
  for (const name of [
    "NODE_OPTIONS",
    "NODE_PATH",
    "BASH_ENV",
    "ENV",
    "NPM_CONFIG_SCRIPT_SHELL",
    "npm_config_registry",
    "NPM_CONFIG_CACHE",
    "HOME",
    "OPENAI_API_KEY",
  ]) {
    assert.equal(Object.hasOwn(environment, name), false, name);
  }
  assert.equal(environment.NPM_CONFIG_USERCONFIG, os.devNull);
});

test("detects repository residuals after the content scan passes", async () => {
  await withFixture(async (repoRoot) => {
    await writeFile(path.join(repoRoot, "capstone-session.jsonl"), "{}\n");
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=residuals status=FAIL errorKind=ResidualArtifactDetected",
      "result=FAIL",
    ]);
  });
});

test("detects a Session residual inside a target directory", async () => {
  await withFixture(async (repoRoot) => {
    const targetDirectory = path.join(repoRoot, "labs/8.8-capstone/target");
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(path.join(targetDirectory, "session.jsonl"), "{}\n");
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=residuals status=FAIL errorKind=ResidualArtifactDetected",
      "result=FAIL",
    ]);
  });
});

test("allows fixture logs but rejects a non-fixture course log", async () => {
  await withFixture(async (repoRoot) => {
    const fixtureDirectory = path.join(repoRoot, "labs/8.8-capstone/fixtures");
    await mkdir(fixtureDirectory, { recursive: true });
    await writeFile(path.join(fixtureDirectory, "expected.log"), "fixture\n");
    await runCapstoneCheck({
      repoRoot,
      runCommand: async () => {},
      emit: () => {},
    });

    await writeFile(path.join(repoRoot, "capstone-debug.log"), "debug\n");
    const stderr = [];
    const exitCode = await runCapstoneCli({
      repoRoot,
      runCommand: async () => {},
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stderr, [
      "stage=residuals status=FAIL errorKind=ResidualArtifactDetected",
      "result=FAIL",
    ]);
  });
});
