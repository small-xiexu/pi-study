import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const runnerDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(runnerDir, "../../..");
const packageJsonPath = path.join(repoRoot, "package.json");
const tempPrefix = path.join(os.tmpdir(), "pi-study-6.3-local-package-");
const packageName = "pi-study-workbench";
const packageVersion = "0.1.0";

const expectedPiManifest = {
  extensions: ["./.pi/extensions/pi-study-guard/index.ts"],
  skills: ["./.agents/skills/java-readonly-analysis"],
  prompts: ["./.pi/prompts/java-review.md"],
  themes: ["./.pi/themes/pi-study-lab.json"],
};

const expectedPeerDependencies = {
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
  typebox: "*",
};

const forbiddenTarballPatterns = [
  /(^|\/)settings\.json$/,
  /(^|\/)test\//,
  /(^|\/)labs\//,
  /(^|\/)docs\/plans\//,
  /(^|\/)sessions?\//,
  /(^|\/)node_modules\//,
  /(^|\/)auth\.json$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)package-lock\.json$/,
];

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 90_000,
      ...options,
    });
  } catch (error) {
    const stdout = error?.stdout ?? "";
    const stderr = error?.stderr ?? "";
    const status = error?.code ?? error?.signal ?? "unknown";
    throw new Error(
      `${command} failed with ${status}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      { cause: error },
    );
  }
}

function isolatedEnvironment({ homeDir, cacheDir, agentDir }) {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: homeDir,
    TMPDIR: os.tmpdir(),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    CI: "1",
    NO_COLOR: "1",
    TERM: "dumb",
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    GIT_TERMINAL_PROMPT: "0",
    NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/",
    NPM_CONFIG_CACHE: cacheDir,
    NPM_CONFIG_USERCONFIG: path.join(homeDir, ".npmrc"),
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FETCH_RETRIES: "0",
    NPM_CONFIG_FETCH_TIMEOUT: "1000",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  };
}

async function createScope(tempRoot, name, packageSource) {
  const scopeRoot = path.join(tempRoot, name);
  const agentDir = path.join(scopeRoot, "agent");
  const homeDir = path.join(scopeRoot, "home");
  const cacheDir = path.join(scopeRoot, "npm-cache");
  const projectDir = path.join(scopeRoot, "project");
  await Promise.all(
    [agentDir, homeDir, cacheDir, projectDir].map((dir) =>
      mkdir(dir, { recursive: true, mode: 0o700 }),
    ),
  );
  await writeFile(
    path.join(agentDir, "settings.json"),
    `${JSON.stringify({ packages: [packageSource] }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return {
    agentDir,
    projectDir,
    env: isolatedEnvironment({ homeDir, cacheDir, agentDir }),
  };
}

function parseNpmJson(stdout, operation) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${operation} did not return JSON: ${stdout}`, { cause: error });
  }
  const result = Array.isArray(value) ? value[0] : value;
  if (!result || !Array.isArray(result.files)) {
    throw new Error(`${operation} did not report a files array: ${stdout}`);
  }
  return result;
}

function normalizedFileList(result) {
  return result.files.map((file) => file.path).sort();
}

async function locatePiRuntime(env) {
  const piBin = process.env.PI_BIN ?? "pi";
  const [{ stdout: versionOutput }, { stdout: whichOutput }] = await Promise.all([
    run(piBin, ["--version"], { env }),
    run("which", [piBin], { env }),
  ]);
  const version = versionOutput.trim();
  assert.equal(version, "0.84.2", `Expected Pi 0.84.2, received ${version}`);
  const cliPath = await realpath(whichOutput.trim());
  const indexPath = path.join(path.dirname(cliPath), "index.js");
  await access(indexPath);
  return { piBin, version, indexPath };
}

async function inspectSource({ sourceRoot, scope, piRuntime }) {
  const piModule = await import(pathToFileURL(piRuntime.indexPath).href);
  const loader = new piModule.DefaultResourceLoader({
    cwd: scope.projectDir,
    agentDir: scope.agentDir,
    noContextFiles: true,
  });
  await loader.reload();

  const extensionResult = loader.getExtensions();
  const skillResult = loader.getSkills();
  const promptResult = loader.getPrompts();
  const themeResult = loader.getThemes();
  const diagnostics =
    extensionResult.errors.length +
    skillResult.diagnostics.length +
    promptResult.diagnostics.length +
    themeResult.diagnostics.length;

  const extensionFlag = extensionResult.extensions.filter((extension) =>
    extension.flags.has("pi-study-guard"),
  );
  const extensionCommand = extensionResult.extensions.filter((extension) =>
    extension.commands.has("study-inspect"),
  );
  const skills = skillResult.skills.filter(
    (skill) => skill.name === "java-readonly-analysis",
  );
  const prompts = promptResult.prompts.filter(
    (prompt) => prompt.name === "java-review",
  );
  const themes = themeResult.themes.filter((theme) => theme.name === "pi-study-lab");

  for (const resourcePath of [
    ...extensionFlag.map((extension) => extension.resolvedPath),
    ...skills.map((skill) => skill.filePath),
    ...prompts.map((prompt) => prompt.filePath),
    ...themes.map((theme) => theme.sourcePath),
  ]) {
    assert.equal(typeof resourcePath, "string", "Resource path must be available");
    const relativePath = path.relative(sourceRoot, resourcePath);
    assert.ok(
      relativePath !== "" &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath),
      `Resource escaped Package root: ${resourcePath}`,
    );
  }

  const { stdout, stderr } = await run(
    piRuntime.piBin,
    [
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-tools",
      "--offline",
      "--help",
    ],
    { cwd: scope.projectDir, env: scope.env },
  );
  const helpOutput = `${stdout}\n${stderr}`;
  const helpFlagCount = (helpOutput.match(/^\s*--pi-study-guard\b/gm) ?? []).length;

  return {
    extensionFlag: helpFlagCount === 1 ? extensionFlag.length : helpFlagCount,
    extensionCommand: extensionCommand.length,
    skill: skills.length,
    prompt: prompts.length,
    theme: themes.length,
    diagnostics,
  };
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  let tempRoot;
  let summary;
  try {
    tempRoot = await mkdtemp(tempPrefix);
    const packHome = path.join(tempRoot, "pack-home");
    const packCache = path.join(tempRoot, "pack-cache");
    const packAgent = path.join(tempRoot, "pack-agent");
    const tarballDir = path.join(tempRoot, "tarballs");
    const extractDir = path.join(tempRoot, "extract");
    await Promise.all(
      [packHome, packCache, packAgent, tarballDir, extractDir].map((dir) =>
        mkdir(dir, { recursive: true, mode: 0o700 }),
      ),
    );
    const packEnv = isolatedEnvironment({
      homeDir: packHome,
      cacheDir: packCache,
      agentDir: packAgent,
    });

    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
    assert.equal(manifest.name, packageName);
    assert.equal(manifest.version, packageVersion);
    assert.equal(manifest.license, "UNLICENSED");
    assert.deepEqual(manifest.keywords, ["pi-package"]);
    assert.deepEqual(manifest.pi, expectedPiManifest);
    assert.deepEqual(manifest.peerDependencies, expectedPeerDependencies);
    assert.equal(manifest.dependencies, undefined);

    const expectedFiles = ["README.md", "package.json", ...manifest.files].sort();
    for (const file of manifest.files) {
      assert.ok(!path.isAbsolute(file) && !file.includes(".."), `Unsafe files entry: ${file}`);
      await access(path.join(repoRoot, file));
    }

    const { stdout: dryRunOutput } = await run(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts", "--offline"],
      { cwd: repoRoot, env: packEnv },
    );
    const dryRun = parseNpmJson(dryRunOutput, "npm pack --dry-run");
    const dryRunFiles = normalizedFileList(dryRun);
    assert.deepEqual(dryRunFiles, expectedFiles);

    await run(
      "npm",
      ["publish", "--dry-run", "--json", "--ignore-scripts", "--offline"],
      { cwd: repoRoot, env: packEnv },
    );

    const { stdout: packOutput } = await run(
      "npm",
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--offline",
        "--pack-destination",
        tarballDir,
      ],
      { cwd: repoRoot, env: packEnv },
    );
    const packed = parseNpmJson(packOutput, "npm pack");
    const packedFiles = normalizedFileList(packed);
    assert.deepEqual(packedFiles, expectedFiles);
    for (const file of packedFiles) {
      assert.ok(
        forbiddenTarballPatterns.every((pattern) => !pattern.test(file)),
        `Forbidden tarball file: ${file}`,
      );
    }

    const tarballPath = path.join(tarballDir, packed.filename);
    const tarballData = await readFile(tarballPath);
    const tarballSha256 = createHash("sha256").update(tarballData).digest("hex");
    await run("tar", ["-xzf", tarballPath, "-C", extractDir], { env: packEnv });
    const archiveRoot = path.join(extractDir, "package");
    await access(path.join(archiveRoot, "package.json"));

    const sourceScope = await createScope(tempRoot, "source-scope", repoRoot);
    const archiveScope = await createScope(tempRoot, "archive-scope", archiveRoot);
    const piRuntime = await locatePiRuntime(packEnv);
    const npmVersion = (await run("npm", ["--version"], { env: packEnv })).stdout.trim();
    const source = await inspectSource({
      sourceRoot: repoRoot,
      scope: sourceScope,
      piRuntime,
    });
    const archive = await inspectSource({
      sourceRoot: archiveRoot,
      scope: archiveScope,
      piRuntime,
    });
    const expectedObservation = {
      extensionFlag: 1,
      extensionCommand: 1,
      skill: 1,
      prompt: 1,
      theme: 1,
      diagnostics: 0,
    };
    assert.deepEqual(source, expectedObservation);
    assert.deepEqual(archive, expectedObservation);

    summary = {
      piVersion: piRuntime.version,
      nodeVersion: process.version,
      npmVersion,
      tarballFiles: packedFiles.length,
      tarballSha256,
      source,
      archive,
    };
  } finally {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  }

  const tempResiduals = tempRoot && (await pathExists(tempRoot)) ? 1 : 0;
  assert.equal(tempResiduals, 0);
  console.log("network=offline");
  console.log(`pi_version=${summary.piVersion}`);
  console.log(`node_version=${summary.nodeVersion}`);
  console.log(`npm_version=${summary.npmVersion}`);
  console.log(`package=${packageName}@${packageVersion}`);
  console.log("license=UNLICENSED");
  console.log("publish_dry_run=true");
  console.log(`tarball_files=${summary.tarballFiles}`);
  console.log(`tarball_sha256=${summary.tarballSha256}`);
  console.log(`source_extension_flag=${summary.source.extensionFlag}`);
  console.log(`source_extension_command=${summary.source.extensionCommand}`);
  console.log(`source_skill=${summary.source.skill}`);
  console.log(`source_prompt=${summary.source.prompt}`);
  console.log(`source_theme=${summary.source.theme}`);
  console.log(`archive_extension_flag=${summary.archive.extensionFlag}`);
  console.log(`archive_extension_command=${summary.archive.extensionCommand}`);
  console.log(`archive_skill=${summary.archive.skill}`);
  console.log(`archive_prompt=${summary.archive.prompt}`);
  console.log(`archive_theme=${summary.archive.theme}`);
  console.log(`diagnostics=${summary.source.diagnostics + summary.archive.diagnostics}`);
  console.log(`temp_residuals=${tempResiduals}`);
  console.log("result=PASS");
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
