import { execFile } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const runnerPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(runnerPath), "../..");
const capstoneScript = "node labs/8.8-capstone/run-capstone-check.mjs";

export const CAPSTONE_COMMANDS = Object.freeze([
  Object.freeze({
    stage: "extension",
    command: "npm",
    args: Object.freeze([
      "--prefix",
      ".pi/extensions/pi-study-guard",
      "run",
      "check",
    ]),
  }),
  Object.freeze({
    stage: "package-artifact",
    command: "node",
    args: Object.freeze([
      "labs/6.3-local-package/scripts/run-package-artifact-lab.mjs",
    ]),
  }),
  Object.freeze({
    stage: "sdk-task-console",
    command: "npm",
    args: Object.freeze([
      "--prefix",
      "labs/7.7-sdk-task-console",
      "run",
      "check",
    ]),
  }),
]);

export const REQUIRED_FILES = Object.freeze([
  "AGENTS.md",
  "README.md",
  "package.json",
  ".pi/extensions/pi-study-guard/package.json",
  ".pi/extensions/pi-study-guard/package-lock.json",
  ".pi/prompts/java-review.md",
  ".agents/skills/java-readonly-analysis/SKILL.md",
  "labs/6.3-local-package/scripts/run-package-artifact-lab.mjs",
  "labs/7.1-sdk/package.json",
  "labs/7.1-sdk/package-lock.json",
  "labs/7.7-sdk-task-console/package.json",
  "labs/7.7-sdk-task-console/package-lock.json",
  "labs/7.7-sdk-task-console/task-console-runtime.ts",
  "labs/7.7-sdk-task-console/test/read-path-gate.test.ts",
  "labs/8.8-capstone/README.md",
  "labs/8.8-capstone/run-capstone-check.mjs",
  "labs/8.8-capstone/test/run-capstone-check.test.mjs",
  "docs/learning/README.md",
  "docs/learning/09-source-and-capstone.md",
]);

export const PASS_STAGES = Object.freeze([
  ...CAPSTONE_COMMANDS.map(({ stage }) => stage),
  "required-structure",
  "sensitive-patterns",
  "residuals",
]);

const DOCUMENT_CONTRACTS = Object.freeze([
  Object.freeze({
    file: "docs/learning/README.md",
    patterns: Object.freeze([
      /^# Pi 学习资料索引$/mu,
      /\[09-source-and-capstone\.md\]\(09-source-and-capstone\.md\)/u,
    ]),
  }),
  Object.freeze({
    file: "docs/learning/09-source-and-capstone.md",
    patterns: Object.freeze([
      /^# Pi 源码核心逻辑与综合项目$/mu,
      /^## 当前证据边界$/mu,
    ]),
  }),
  Object.freeze({
    file: "labs/8.8-capstone/README.md",
    patterns: Object.freeze([
      /^# .+$/mu,
      /node labs\/8\.8-capstone\/run-capstone-check\.mjs/u,
    ]),
  }),
]);

const LOCKFILE_CONTRACTS = Object.freeze([
  Object.freeze({
    file: ".pi/extensions/pi-study-guard/package-lock.json",
    name: "pi-study-guard",
    version: "0.0.0",
    dependencySection: "devDependencies",
    dependencies: Object.freeze({
      "@earendil-works/pi-coding-agent": "0.84.1",
      "@earendil-works/pi-tui": "0.84.1",
    }),
  }),
  Object.freeze({
    file: "labs/7.1-sdk/package-lock.json",
    name: "pi-study-sdk-7-1",
    version: "0.0.0",
    dependencySection: "dependencies",
    dependencies: Object.freeze({
      "@earendil-works/pi-coding-agent": "0.84.2",
    }),
  }),
  Object.freeze({
    file: "labs/7.7-sdk-task-console/package-lock.json",
    name: "pi-study-sdk-task-console-7-7",
    version: "0.0.0",
    dependencySection: "dependencies",
    dependencies: Object.freeze({
      "@earendil-works/pi-ai": "0.84.3",
      "@earendil-works/pi-coding-agent": "0.84.3",
    }),
  }),
]);

const SENSITIVE_SCAN_ROOTS = Object.freeze([
  "AGENTS.md",
  "README.md",
  "package.json",
  ".agents/skills/java-readonly-analysis",
  ".pi",
  "docs/learning",
  "labs/6.3-local-package",
  "labs/7.1-sdk",
  "labs/7.7-sdk-task-console",
  "labs/8.8-capstone",
]);

const SENSITIVE_SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "target",
]);
const RESIDUAL_SKIPPED_DIRECTORY_NAMES = new Set([".git", "node_modules"]);
const SCANNED_TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const MAX_SCANNED_FILE_BYTES = 1024 * 1024;

const SENSITIVE_CONTENT_PATTERNS = Object.freeze([
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
  /\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{35}\b/u,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/u,
]);

const STATIC_CHECKS = Object.freeze([
  Object.freeze({ stage: "required-structure", check: checkRequiredStructure }),
  Object.freeze({ stage: "sensitive-patterns", check: checkSensitivePatterns }),
  Object.freeze({ stage: "residuals", check: checkResiduals }),
]);

const PASSTHROUGH_ENVIRONMENT_NAMES = Object.freeze([
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PI_BIN",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
]);

export class CapstoneCheckError extends Error {
  constructor(stage, errorKind) {
    super(`${stage}:${errorKind}`);
    this.name = "CapstoneCheckError";
    this.stage = stage;
    this.errorKind = errorKind;
  }
}

export function buildChildEnvironment(sourceEnvironment) {
  const environment = {};
  for (const name of PASSTHROUGH_ENVIRONMENT_NAMES) {
    const value = sourceEnvironment[name];
    if (value !== undefined) environment[name] = value;
  }
  return {
    ...environment,
    CI: "1",
    GIT_TERMINAL_PROMPT: "0",
    NO_COLOR: "1",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_USERCONFIG: os.devNull,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    TERM: "dumb",
  };
}

async function executeCommand(specification, options) {
  await execFileAsync(specification.command, specification.args, {
    cwd: options.repoRoot,
    encoding: "utf8",
    env: buildChildEnvironment(options.environment),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
  });
}

async function requiredRegularFile(repoRoot, relativePath) {
  let stats;
  try {
    stats = await lstat(path.join(repoRoot, relativePath));
  } catch {
    throw new CapstoneCheckError("required-structure", "RequiredEntryMissing");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new CapstoneCheckError(
      "required-structure",
      "RequiredEntryNotRegularFile",
    );
  }
}

async function readRequiredDocument(repoRoot, relativePath) {
  try {
    return await readFile(path.join(repoRoot, relativePath), "utf8");
  } catch {
    throw new CapstoneCheckError(
      "required-structure",
      "RequiredEntryUnreadable",
    );
  }
}

async function checkLockfileContracts(repoRoot) {
  for (const contract of LOCKFILE_CONTRACTS) {
    const content = await readRequiredDocument(repoRoot, contract.file);
    let lockfile;
    try {
      lockfile = JSON.parse(content);
    } catch {
      throw new CapstoneCheckError(
        "required-structure",
        "LockfileJsonInvalid",
      );
    }

    const rootPackage = lockfile?.packages?.[""];
    const dependencyVersions = rootPackage?.[contract.dependencySection];
    const dependenciesMatch = Object.entries(contract.dependencies).every(
      ([name, version]) => dependencyVersions?.[name] === version,
    );
    const resolvedVersionsMatch = Object.entries(contract.dependencies).every(
      ([name, version]) =>
        lockfile?.packages?.[`node_modules/${name}`]?.version === version,
    );
    if (
      lockfile?.lockfileVersion !== 3 ||
      lockfile?.name !== contract.name ||
      lockfile?.version !== contract.version ||
      rootPackage?.name !== contract.name ||
      rootPackage?.version !== contract.version ||
      !dependenciesMatch ||
      !resolvedVersionsMatch
    ) {
      throw new CapstoneCheckError(
        "required-structure",
        "LockfileContractViolation",
      );
    }
  }
}

export async function checkRequiredStructure(repoRoot) {
  for (const relativePath of REQUIRED_FILES) {
    await requiredRegularFile(repoRoot, relativePath);
  }
  const packageJson = await readRequiredDocument(repoRoot, "package.json");
  let packageManifest;
  try {
    packageManifest = JSON.parse(packageJson);
  } catch {
    throw new CapstoneCheckError(
      "required-structure",
      "RootPackageJsonInvalid",
    );
  }
  if (packageManifest?.scripts?.["capstone:check"] !== capstoneScript) {
    throw new CapstoneCheckError(
      "required-structure",
      "PackageScriptContractViolation",
    );
  }
  await checkLockfileContracts(repoRoot);
  for (const contract of DOCUMENT_CONTRACTS) {
    const content = await readRequiredDocument(repoRoot, contract.file);
    if (contract.patterns.some((pattern) => !pattern.test(content))) {
      throw new CapstoneCheckError(
        "required-structure",
        "DocumentationContractViolation",
      );
    }
  }
}

function shouldScanTextFile(fileName) {
  return SCANNED_TEXT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

async function visitTextFiles(targetPath, onFile) {
  let stats;
  try {
    stats = await lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new CapstoneCheckError("sensitive-patterns", "SensitiveScanFailed");
  }

  if (stats.isSymbolicLink()) {
    throw new CapstoneCheckError("sensitive-patterns", "SensitiveScanFailed");
  }
  if (stats.isFile()) {
    if (!shouldScanTextFile(path.basename(targetPath))) return;
    if (stats.size > MAX_SCANNED_FILE_BYTES) {
      throw new CapstoneCheckError(
        "sensitive-patterns",
        "SensitiveScanLimitExceeded",
      );
    }
    await onFile(targetPath);
    return;
  }
  if (!stats.isDirectory()) return;

  let entries;
  try {
    entries = await readdir(targetPath);
  } catch {
    throw new CapstoneCheckError("sensitive-patterns", "SensitiveScanFailed");
  }
  for (const name of entries.sort()) {
    if (SENSITIVE_SKIPPED_DIRECTORY_NAMES.has(name)) continue;
    await visitTextFiles(path.join(targetPath, name), onFile);
  }
}

export async function checkSensitivePatterns(repoRoot) {
  for (const relativeRoot of SENSITIVE_SCAN_ROOTS) {
    await visitTextFiles(path.join(repoRoot, relativeRoot), async (filePath) => {
      let content;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        throw new CapstoneCheckError(
          "sensitive-patterns",
          "SensitiveScanFailed",
        );
      }
      if (SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(content))) {
        throw new CapstoneCheckError(
          "sensitive-patterns",
          "SensitiveContentDetected",
        );
      }
    });
  }
}

function isFixtureLog(relativePath, fileName) {
  const segments = relativePath.split(path.sep);
  return (
    fileName.endsWith(".log") &&
    segments.some((segment) => /^fixtures?$/iu.test(segment))
  );
}

function isResidual(relativePath) {
  const fileName = path.basename(relativePath);
  const lowerName = fileName.toLowerCase();
  if (lowerName === ".env" || lowerName.startsWith(".env.")) return true;
  if (lowerName === "auth.json" || lowerName === "credentials.json") return true;
  if (lowerName.endsWith(".jsonl") || lowerName.endsWith(".tgz")) return true;
  if (/^\.pi-study-.+-(?:lease|owner)$/u.test(fileName)) return true;
  return lowerName.endsWith(".log") && !isFixtureLog(relativePath, lowerName);
}

async function findResidual(targetPath, repoRoot) {
  let stats;
  try {
    stats = await lstat(targetPath);
  } catch {
    throw new CapstoneCheckError("residuals", "ResidualScanFailed");
  }

  const relativePath = path.relative(repoRoot, targetPath);
  if (relativePath && isResidual(relativePath)) return true;
  if (stats.isSymbolicLink() || !stats.isDirectory()) return false;

  let entries;
  try {
    entries = await readdir(targetPath);
  } catch {
    throw new CapstoneCheckError("residuals", "ResidualScanFailed");
  }
  for (const name of entries.sort()) {
    if (RESIDUAL_SKIPPED_DIRECTORY_NAMES.has(name)) continue;
    if (await findResidual(path.join(targetPath, name), repoRoot)) return true;
  }
  return false;
}

export async function checkResiduals(repoRoot) {
  if (await findResidual(repoRoot, repoRoot)) {
    throw new CapstoneCheckError("residuals", "ResidualArtifactDetected");
  }
}

export async function runCapstoneCheck(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const environment = options.environment ?? process.env;
  const runCommand = options.runCommand ?? executeCommand;
  const emit = options.emit ?? ((line) => console.log(line));

  for (const specification of CAPSTONE_COMMANDS) {
    try {
      await runCommand(specification, { repoRoot, environment });
    } catch {
      throw new CapstoneCheckError(specification.stage, "SubcommandFailed");
    }
    emit(`stage=${specification.stage} status=PASS`);
  }

  for (const { stage, check } of STATIC_CHECKS) {
    try {
      await check(repoRoot);
    } catch (error) {
      if (error instanceof CapstoneCheckError) throw error;
      throw new CapstoneCheckError(stage, "InternalCheckFailure");
    }
    emit(`stage=${stage} status=PASS`);
  }
  emit("result=PASS");
}

export async function runCapstoneCli(options = {}) {
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  try {
    await runCapstoneCheck({
      repoRoot: options.repoRoot,
      environment: options.environment,
      runCommand: options.runCommand,
      emit: stdout,
    });
    return 0;
  } catch (error) {
    const failure =
      error instanceof CapstoneCheckError
        ? error
        : new CapstoneCheckError("capstone", "InternalFailure");
    stderr(`stage=${failure.stage} status=FAIL errorKind=${failure.errorKind}`);
    stderr("result=FAIL");
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === runnerPath) {
  process.exitCode = await runCapstoneCli();
}
