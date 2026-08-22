import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const jsonMode = process.argv.includes("--json");
const configTuiMode = process.argv.includes("--config-tui");
const guidedMode = process.argv.includes("--guided");
const runnerDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(runnerDir, "../../..");
const packageName = "pi-study-workbench";
const versionA = "0.1.0";
const versionB = "0.1.1";
const source = `npm:${packageName}@^0.1.0`;
const tempPrefix = path.join(os.tmpdir(), "pi-study-6.4-package-management-");
const extensionPath = "./.pi/extensions/pi-study-guard/index.ts";

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

function isolatedEnvironment({ homeDir, cacheDir, agentDir, registryUrl }) {
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
    PI_TELEMETRY: "0",
    GIT_TERMINAL_PROMPT: "0",
    NPM_CONFIG_REGISTRY: registryUrl,
    NPM_CONFIG_CACHE: cacheDir,
    NPM_CONFIG_USERCONFIG: path.join(homeDir, ".npmrc"),
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FETCH_RETRIES: "0",
    NPM_CONFIG_FETCH_TIMEOUT: "10000",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  };
}

function packEnvironment(homeDir, cacheDir) {
  return isolatedEnvironment({
    homeDir,
    cacheDir,
    agentDir: path.join(homeDir, "agent"),
    registryUrl: "http://127.0.0.1:9/",
  });
}

function parsePackOutput(stdout, operation) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${operation} did not return JSON: ${stdout}`, { cause: error });
  }
  const result = Array.isArray(value) ? value[0] : value;
  if (!result?.filename || !Array.isArray(result.files)) {
    throw new Error(`${operation} did not report a complete tarball: ${stdout}`);
  }
  return result;
}

async function packSource(sourceRoot, tarballsDir, env) {
  const { stdout } = await run(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      tarballsDir,
    ],
    { cwd: sourceRoot, env },
  );
  const packed = parsePackOutput(stdout, `npm pack ${sourceRoot}`);
  const filePath = path.join(tarballsDir, packed.filename);
  const data = await readFile(filePath);
  return {
    filename: packed.filename,
    files: packed.files.map((file) => file.path).sort(),
    data,
    sha256: createHash("sha256").update(data).digest("hex"),
    shasum: createHash("sha1").update(data).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(data).digest("base64")}`,
  };
}

async function createTarballs(tempRoot) {
  const tarballsDir = path.join(tempRoot, "tarballs");
  const packHome = path.join(tempRoot, "pack-home");
  const packCache = path.join(tempRoot, "pack-cache");
  const extractRoot = path.join(tempRoot, "version-b-source");
  await Promise.all(
    [tarballsDir, packHome, packCache, extractRoot].map((directory) =>
      mkdir(directory, { recursive: true, mode: 0o700 }),
    ),
  );
  const env = packEnvironment(packHome, packCache);
  const tarballA = await packSource(repoRoot, tarballsDir, env);

  await run("tar", ["-xzf", path.join(tarballsDir, tarballA.filename), "-C", extractRoot], {
    env,
  });
  const versionBRoot = path.join(extractRoot, "package");
  const manifestPath = path.join(versionBRoot, "package.json");
  const manifestB = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifestB.name, packageName);
  assert.equal(manifestB.version, versionA);
  manifestB.version = versionB;
  manifestB.description = `${manifestB.description} Package management B fixture.`;
  await writeFile(manifestPath, `${JSON.stringify(manifestB, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const tarballB = await packSource(versionBRoot, tarballsDir, env);

  assert.equal(tarballA.files.length, 19);
  assert.deepEqual(tarballB.files, tarballA.files);
  assert.notEqual(tarballA.sha256, tarballB.sha256);

  const manifestA = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  return { manifestA, manifestB, tarballA, tarballB };
}

function packageVersionManifest(manifest, version, tarball, registryUrl) {
  return {
    ...manifest,
    version,
    dist: {
      tarball: `${registryUrl}${packageName}/-/${tarball.filename}`,
      shasum: tarball.shasum,
      integrity: tarball.integrity,
    },
  };
}

function sendJson(response, status, body, etag) {
  const data = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": data.length,
    "cache-control": "no-store, no-cache, must-revalidate",
    etag,
  });
  response.end(data);
}

async function startRegistry(artifacts) {
  let publishedB = false;
  let registryUrl;
  const requests = [];
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);
    requests.push({ method: request.method ?? "GET", pathname });

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "method_not_allowed" }, '"method"');
      return;
    }

    if (pathname === `/${packageName}`) {
      const versions = {
        [versionA]: packageVersionManifest(
          artifacts.manifestA,
          versionA,
          artifacts.tarballA,
          registryUrl,
        ),
      };
      if (publishedB) {
        versions[versionB] = packageVersionManifest(
          artifacts.manifestB,
          versionB,
          artifacts.tarballB,
          registryUrl,
        );
      }
      sendJson(
        response,
        200,
        {
          _id: packageName,
          name: packageName,
          "dist-tags": { latest: publishedB ? versionB : versionA },
          versions,
        },
        publishedB ? '"management-b"' : '"management-a"',
      );
      return;
    }

    const tarballs = new Map([
      [`/${packageName}/-/${artifacts.tarballA.filename}`, artifacts.tarballA],
      [
        `/${packageName}/-/${artifacts.tarballB.filename}`,
        publishedB ? artifacts.tarballB : undefined,
      ],
    ]);
    if (tarballs.has(pathname)) {
      const tarball = tarballs.get(pathname);
      if (!tarball) {
        sendJson(response, 404, { error: "version_not_published" }, '"missing"');
        return;
      }
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": tarball.data.length,
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : tarball.data);
      return;
    }

    sendJson(response, 404, { error: "not_found", pathname }, '"missing"');
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Loopback npm registry did not expose a TCP port");
  }
  registryUrl = `http://127.0.0.1:${address.port}/`;
  return {
    server,
    registryUrl,
    requests,
    publishB() {
      publishedB = true;
    },
  };
}

async function stopRegistry(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      reject(new Error("Loopback npm registry did not stop in time"));
    }, 2_000);
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
    server.closeAllConnections?.();
  });
}

async function createScope(tempRoot, registryUrl) {
  const agentDir = path.join(tempRoot, "agent");
  const homeDir = path.join(tempRoot, "home");
  const cacheDir = path.join(tempRoot, "npm-cache");
  const projectDir = path.join(tempRoot, "project");
  await Promise.all(
    [agentDir, homeDir, cacheDir, projectDir].map((directory) =>
      mkdir(directory, { recursive: true, mode: 0o700 }),
    ),
  );
  return {
    agentDir,
    homeDir,
    cacheDir,
    projectDir,
    registryUrl,
    userSettingsPath: path.join(agentDir, "settings.json"),
    projectSettingsPath: path.join(projectDir, ".pi", "settings.json"),
    userInstallPath: path.join(agentDir, "npm", "node_modules", packageName),
    projectInstallPath: path.join(
      projectDir,
      ".pi",
      "npm",
      "node_modules",
      packageName,
    ),
    env: isolatedEnvironment({ homeDir, cacheDir, agentDir, registryUrl }),
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

async function writeGuidedEnvironment(tempRoot, scope) {
  const envFile = path.join(tempRoot, "guided-env.sh");
  const exportedKeys = [
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "PI_CODING_AGENT_DIR",
    "PI_TELEMETRY",
    "GIT_TERMINAL_PROMPT",
    "NPM_CONFIG_REGISTRY",
    "NPM_CONFIG_CACHE",
    "NPM_CONFIG_USERCONFIG",
    "NPM_CONFIG_IGNORE_SCRIPTS",
    "NPM_CONFIG_AUDIT",
    "NPM_CONFIG_FUND",
    "NPM_CONFIG_UPDATE_NOTIFIER",
    "NPM_CONFIG_FETCH_RETRIES",
    "NPM_CONFIG_FETCH_TIMEOUT",
    "NO_PROXY",
    "no_proxy",
  ];
  const lines = [
    "# Generated isolation environment for the Pi 6.4 guided lab.",
    ...exportedKeys.map((key) => `export ${key}=${shellQuote(scope.env[key])}`),
    `export PI_STUDY_64_SOURCE=${shellQuote(source)}`,
    `export PI_STUDY_64_USER_SETTINGS=${shellQuote(scope.userSettingsPath)}`,
    `export PI_STUDY_64_PROJECT_SETTINGS=${shellQuote(scope.projectSettingsPath)}`,
    `export PI_STUDY_64_USER_INSTALL=${shellQuote(scope.userInstallPath)}`,
    `export PI_STUDY_64_PROJECT_INSTALL=${shellQuote(scope.projectInstallPath)}`,
    `cd ${shellQuote(scope.projectDir)}`,
    "",
  ];
  await writeFile(envFile, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
  return envFile;
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

async function readSettings(settingsPath) {
  try {
    return JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function writeSettings(settingsPath, settings) {
  await mkdir(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function packageEntries(settings) {
  return Array.isArray(settings.packages) ? settings.packages : [];
}

function configuredSource(entry) {
  return typeof entry === "string" ? entry : entry?.source;
}

async function configurationState(scope) {
  const [userSettings, projectSettings] = await Promise.all([
    readSettings(scope.userSettingsPath),
    readSettings(scope.projectSettingsPath),
  ]);
  return {
    userConfigured: packageEntries(userSettings).some(
      (entry) => configuredSource(entry) === source,
    ),
    projectConfigured: packageEntries(projectSettings).some(
      (entry) => configuredSource(entry) === source,
    ),
  };
}

async function runPi(args, scope) {
  return run(process.env.PI_BIN ?? "pi", args, {
    cwd: scope.projectDir,
    env: scope.env,
  });
}

async function runPiInteractive(args, scope) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.PI_BIN ?? "pi", args, {
      cwd: scope.projectDir,
      env: {
        ...scope.env,
        CI: "0",
        NO_COLOR: process.env.NO_COLOR ?? "0",
        TERM: process.env.TERM ?? "xterm-256color",
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`pi config exited with ${code ?? signal ?? "unknown"}`));
    });
  });
}

async function locatePiRuntime(scope) {
  const piBin = process.env.PI_BIN ?? "pi";
  const [{ stdout: versionOutput }, { stdout: whichOutput }] = await Promise.all([
    runPi(["--version"], scope),
    run("which", [piBin], { env: scope.env }),
  ]);
  const piVersion = versionOutput.trim();
  assert.equal(piVersion, "0.84.2");
  const cliPath = await realpath(whichOutput.trim());
  const indexPath = path.join(path.dirname(cliPath), "index.js");
  await access(indexPath);
  return { piBin, piVersion, indexPath };
}

function parseListOutput(output) {
  let section;
  const counts = { user: 0, project: 0 };
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "User packages:") {
      section = "user";
      continue;
    }
    if (line.trim() === "Project packages:") {
      section = "project";
      continue;
    }
    if (section && line.trim().startsWith(`npm:${packageName}`)) {
      counts[section] += 1;
    }
  }
  return counts;
}

async function listState(scope) {
  const { stdout, stderr } = await runPi(["list", "--approve"], scope);
  return parseListOutput(`${stdout}\n${stderr}`);
}

async function installedVersion(installPath) {
  const manifest = JSON.parse(await readFile(path.join(installPath, "package.json"), "utf8"));
  assert.equal(manifest.name, packageName);
  assert.equal(typeof manifest.version, "string");
  return manifest.version;
}

async function observeResources(scope, piRuntime) {
  const piModule = await import(pathToFileURL(piRuntime.indexPath).href);
  const settingsManager = piModule.SettingsManager.create(
    scope.projectDir,
    scope.agentDir,
    { projectTrusted: true },
  );
  const loader = new piModule.DefaultResourceLoader({
    cwd: scope.projectDir,
    agentDir: scope.agentDir,
    settingsManager,
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

  const { stdout, stderr } = await runPi(
    [
      "--approve",
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-tools",
      "--help",
    ],
    scope,
  );
  const helpOutput = `${stdout}\n${stderr}`;
  const helpFlagCount = (helpOutput.match(/^\s*--pi-study-guard\b/gm) ?? []).length;

  return {
    extensionFlag: helpFlagCount,
    extensionCommand: extensionResult.extensions.filter((extension) =>
      extension.commands.has("study-inspect"),
    ).length,
    skill: skillResult.skills.filter((skill) => skill.name === "java-readonly-analysis")
      .length,
    prompt: promptResult.prompts.filter((prompt) => prompt.name === "java-review")
      .length,
    theme: themeResult.themes.filter((theme) => theme.name === "pi-study-lab").length,
    diagnostics,
  };
}

async function assertResources(actual, expected, phase) {
  assert.deepEqual(actual, expected, `${phase} resources differed`);
  return actual;
}

async function setProjectPackage(scope, entry) {
  const settings = await readSettings(scope.projectSettingsPath);
  settings.packages = [entry];
  await writeSettings(scope.projectSettingsPath, settings);
}

async function readUserConfiguredSource(scope) {
  const settings = await readSettings(scope.userSettingsPath);
  const entries = packageEntries(settings);
  assert.equal(entries.length, 1);
  const value = configuredSource(entries[0]);
  assert.equal(value, source);
  return value;
}

async function executeLab(tempRoot, artifacts, registry, scope, piRuntime) {
  const observations = {};

  const baselineConfig = await configurationState(scope);
  const baselineList = await listState(scope);
  assert.deepEqual(baselineList, { user: 0, project: 0 });
  observations.baseline = {
    ...baselineConfig,
    userInstalled: await pathExists(scope.userInstallPath),
    projectInstalled: await pathExists(scope.projectInstallPath),
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      noResources,
      "baseline",
    ),
  };

  await runPi(["install", source], scope);
  const userInstallList = await listState(scope);
  const userInstallConfig = await configurationState(scope);
  observations.userInstallA = {
    listUser: userInstallList.user,
    listProject: userInstallList.project,
    ...userInstallConfig,
    userInstalled: await pathExists(scope.userInstallPath),
    projectInstalled: await pathExists(scope.projectInstallPath),
    installedVersion: await installedVersion(scope.userInstallPath),
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      allResources,
      "user install A",
    ),
  };

  await runPi(["install", "-l", "--approve", source], scope);
  const projectInstallList = await listState(scope);
  observations.projectInstallA = {
    listUser: projectInstallList.user,
    listProject: projectInstallList.project,
    userInstalled: await pathExists(scope.userInstallPath),
    projectInstalled: await pathExists(scope.projectInstallPath),
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      allResources,
      "project install A",
    ),
  };

  await setProjectPackage(scope, { source, extensions: [] });
  observations.ordinaryEmpty = {
    filter: { extensions: [] },
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      extensionDisabled,
      "ordinary empty filter",
    ),
  };

  const basePattern = "./.pi/extensions/**/*.ts";
  await setProjectPackage(scope, {
    source,
    extensions: [basePattern, `!${extensionPath}`],
  });
  const excluded = await assertResources(
    await observeResources(scope, piRuntime),
    extensionDisabled,
    "ordinary exclusion",
  );
  await setProjectPackage(scope, {
    source,
    extensions: [basePattern, `!${extensionPath}`, `+${extensionPath}`],
  });
  const forceIncluded = await assertResources(
    await observeResources(scope, piRuntime),
    allResources,
    "ordinary force include",
  );
  await setProjectPackage(scope, {
    source,
    extensions: [
      basePattern,
      `!${extensionPath}`,
      `+${extensionPath}`,
      `-${extensionPath}`,
    ],
  });
  const forceExcluded = await assertResources(
    await observeResources(scope, piRuntime),
    extensionDisabled,
    "ordinary force exclude",
  );
  observations.ordinaryPrecedence = { excluded, forceIncluded, forceExcluded };

  await runPi(["remove", "-l", "--approve", source], scope);
  await setProjectPackage(scope, { source, autoload: false, extensions: [] });
  observations.projectDeltaEmpty = {
    autoload: false,
    projectInstalled: await pathExists(scope.projectInstallPath),
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      allResources,
      "empty project delta",
    ),
  };

  await setProjectPackage(scope, {
    source,
    autoload: false,
    extensions: [`-${extensionPath}`],
  });
  observations.projectDeltaDisabled = {
    autoload: false,
    projectInstalled: await pathExists(scope.projectInstallPath),
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      extensionDisabled,
      "disabled project delta",
    ),
  };

  await runPi(["remove", "-l", "--approve", source], scope);
  registry.publishB();
  await runPi(["update", "--extensions", "--approve"], scope);
  observations.updatedB = {
    configuredSource: await readUserConfiguredSource(scope),
    installedVersion: await installedVersion(scope.userInstallPath),
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      allResources,
      "updated B",
    ),
  };

  await setProjectPackage(scope, {
    source,
    autoload: false,
    extensions: [`-${extensionPath}`],
  });
  observations.projectDeltaAfterUpdate = {
    installedVersion: await installedVersion(scope.userInstallPath),
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      extensionDisabled,
      "project delta after update",
    ),
  };

  await runPi(["remove", "-l", "--approve", source], scope);
  const projectRemovedList = await listState(scope);
  const projectRemovedConfig = await configurationState(scope);
  observations.projectRemoved = {
    listUser: projectRemovedList.user,
    listProject: projectRemovedList.project,
    ...projectRemovedConfig,
    userInstalled: await pathExists(scope.userInstallPath),
    projectInstalled: await pathExists(scope.projectInstallPath),
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      allResources,
      "project removed",
    ),
  };

  await runPi(["remove", source], scope);
  const userRemovedList = await listState(scope);
  const userRemovedConfig = await configurationState(scope);
  observations.userRemoved = {
    listUser: userRemovedList.user,
    listProject: userRemovedList.project,
    ...userRemovedConfig,
    userInstalled: await pathExists(scope.userInstallPath),
    projectInstalled: await pathExists(scope.projectInstallPath),
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      noResources,
      "user removed",
    ),
  };

  await runPi(["install", source], scope);
  const reinstalledList = await listState(scope);
  const reinstalledConfig = await configurationState(scope);
  observations.reinstalledB = {
    listUser: reinstalledList.user,
    listProject: reinstalledList.project,
    userConfigured: reinstalledConfig.userConfigured,
    userInstalled: await pathExists(scope.userInstallPath),
    installedVersion: await installedVersion(scope.userInstallPath),
    resources: await assertResources(
      await observeResources(scope, piRuntime),
      allResources,
      "reinstalled B",
    ),
  };

  return {
    network: "loopback-only",
    host: "127.0.0.1",
    piVersion: piRuntime.piVersion,
    packageName,
    versions: { A: versionA, B: versionB },
    source,
    tarballFiles: {
      A: artifacts.tarballA.files.length,
      B: artifacts.tarballB.files.length,
    },
    tarballSha256: {
      A: artifacts.tarballA.sha256,
      B: artifacts.tarballB.sha256,
    },
    observations,
    registryRequests: registry.requests.length,
    tempResiduals: undefined,
    result: "PASS",
  };
}

async function executeConfigTuiLab(artifacts, registry, scope, piRuntime) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("--config-tui must run in an interactive terminal");
  }

  await runPi(["install", source], scope);
  assert.equal(await installedVersion(scope.userInstallPath), versionA);
  await assertResources(
    await observeResources(scope, piRuntime),
    allResources,
    "config TUI baseline",
  );

  console.log("\n隔离的 Project Local Resources 即将打开：");
  console.log("1. 直接输入 pi-study-guard，筛选到课程 Extension");
  console.log("2. 确认标题是 Project Local Resources");
  console.log("3. 按一次 Space，把继承状态切换为项目级 -（禁用）");
  console.log("4. 设置在切换时已写入；按 Esc 关闭，不要按 Ctrl+C\n");
  await runPiInteractive(["config", "-l", "--approve"], scope);

  const projectSettings = await readSettings(scope.projectSettingsPath);
  const projectEntry = packageEntries(projectSettings).find(
    (entry) => typeof entry === "object" && configuredSource(entry) === source,
  );
  assert.ok(projectEntry, "pi config did not create the expected project package delta");
  assert.equal(projectEntry.autoload, false);
  const extensionEntries = projectEntry.extensions ?? [];
  assert.ok(
    extensionEntries.some((entry) => {
      const target = entry.slice(1).replace(/^\.\//, "");
      return entry.startsWith("-") && target === extensionPath.replace(/^\.\//, "");
    }),
    "pi config did not persist the expected project extension disable delta",
  );
  const resources = await assertResources(
    await observeResources(scope, piRuntime),
    extensionDisabled,
    "config TUI project delta",
  );

  return {
    network: "loopback-only",
    host: "127.0.0.1",
    piVersion: piRuntime.piVersion,
    packageName,
    version: versionA,
    source,
    tarballFiles: artifacts.tarballA.files.length,
    projectDelta: {
      autoload: projectEntry.autoload,
      extensions: extensionEntries,
    },
    resources,
    registryRequests: registry.requests.length,
    tempResiduals: undefined,
    result: "PASS",
  };
}

async function executeGuidedLab(tempRoot, artifacts, registry, scope, piRuntime) {
  const envFile = await writeGuidedEnvironment(tempRoot, scope);
  const baseline = {
    userSettings: await pathExists(scope.userSettingsPath),
    projectSettings: await pathExists(scope.projectSettingsPath),
    userInstall: await pathExists(scope.userInstallPath),
    projectInstall: await pathExists(scope.projectInstallPath),
  };
  assert.deepEqual(baseline, {
    userSettings: false,
    projectSettings: false,
    userInstall: false,
    projectInstall: false,
  });
  assert.equal(registry.requests.length, 0);

  console.log("network=loopback-only");
  console.log("host=127.0.0.1");
  console.log(`pi_version=${piRuntime.piVersion}`);
  console.log(`package=${packageName}`);
  console.log(`version_a=${versionA}`);
  console.log(`version_b=${versionB}`);
  console.log(`source=${source}`);
  console.log(`temp_root=${tempRoot}`);
  console.log(`project_dir=${scope.projectDir}`);
  console.log(`agent_dir=${scope.agentDir}`);
  console.log(`env_file=${envFile}`);
  console.log(`user_settings=${scope.userSettingsPath}`);
  console.log(`project_settings=${scope.projectSettingsPath}`);
  console.log(`user_install=${scope.userInstallPath}`);
  console.log(`project_install=${scope.projectInstallPath}`);
  console.log("baseline_user_settings=0");
  console.log("baseline_project_settings=0");
  console.log("baseline_user_install=0");
  console.log("baseline_project_install=0");
  console.log("registry_requests=0");
  console.log("management_commands=0");
  console.log("guided_registry=A");
  console.log("guided_commands=publish-b,quit");
  console.log("guided_status=READY");

  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let publishedB = false;
  let stopReason = "stdin-closed";
  const stopFromSignal = (signal) => {
    stopReason = signal;
    input.close();
  };
  const onSigint = () => stopFromSignal("SIGINT");
  const onSigterm = () => stopFromSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    for await (const rawCommand of input) {
      const command = rawCommand.trim();
      if (!command) continue;
      if (command === "publish-b") {
        registry.publishB();
        publishedB = true;
        console.log("guided_registry=B");
        continue;
      }
      if (command === "quit") {
        stopReason = "quit";
        break;
      }
      console.log(`guided_error=unknown_command:${command}`);
    }
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    input.close();
  }

  return {
    mode: "guided",
    stopReason,
    publishedB,
    registryRequests: registry.requests.length,
    tempResiduals: undefined,
  };
}

async function runLab() {
  const tempRoot = await mkdtemp(tempPrefix);
  let registry;
  let report;
  try {
    const artifacts = await createTarballs(tempRoot);
    registry = await startRegistry(artifacts);
    const scope = await createScope(tempRoot, registry.registryUrl);
    const piRuntime = await locatePiRuntime(scope);
    report = guidedMode
      ? await executeGuidedLab(tempRoot, artifacts, registry, scope, piRuntime)
      : configTuiMode
        ? await executeConfigTuiLab(artifacts, registry, scope, piRuntime)
        : await executeLab(tempRoot, artifacts, registry, scope, piRuntime);
  } finally {
    try {
      await stopRegistry(registry?.server);
    } finally {
      if (!tempRoot.startsWith(tempPrefix)) {
        throw new Error("Refusing to clean an unexpected temporary path");
      }
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
  report.tempResiduals = (await pathExists(tempRoot)) ? 1 : 0;
  assert.equal(report.tempResiduals, 0);
  return report;
}

try {
  const report = await runLab();
  if (guidedMode) {
    console.log(`guided_stop_reason=${report.stopReason}`);
    console.log(`final_registry_requests=${report.registryRequests}`);
    console.log(`guided_registry=${report.publishedB ? "B" : "A"}`);
    console.log("guided_status=STOPPED");
    console.log(`temp_residuals=${report.tempResiduals}`);
  } else if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else if (configTuiMode) {
    console.log(`network=${report.network}`);
    console.log(`host=${report.host}`);
    console.log(`pi_version=${report.piVersion}`);
    console.log(`package=${report.packageName}@${report.version}`);
    console.log(`source=${report.source}`);
    console.log(`project_autoload=${report.projectDelta.autoload}`);
    console.log(`project_extensions=${report.projectDelta.extensions.join(",")}`);
    console.log(
      `resources=extension:${report.resources.extensionFlag},other:${report.resources.skill + report.resources.prompt + report.resources.theme}`,
    );
    console.log(`registry_requests=${report.registryRequests}`);
    console.log(`temp_residuals=${report.tempResiduals}`);
    console.log(`result=${report.result}`);
  } else {
    console.log(`network=${report.network}`);
    console.log(`host=${report.host}`);
    console.log(`pi_version=${report.piVersion}`);
    console.log(`package=${report.packageName}`);
    console.log(`version_a=${report.versions.A}`);
    console.log(`version_b=${report.versions.B}`);
    console.log(`source=${report.source}`);
    console.log(`tarball_files_a=${report.tarballFiles.A}`);
    console.log(`tarball_files_b=${report.tarballFiles.B}`);
    console.log(`user_install=A@${report.observations.userInstallA.installedVersion}`);
    console.log(
      `ordinary_filter=extension:${report.observations.ordinaryEmpty.resources.extensionFlag},other:1`,
    );
    console.log(
      `ordinary_precedence=${report.observations.ordinaryPrecedence.excluded.extensionFlag}->${report.observations.ordinaryPrecedence.forceIncluded.extensionFlag}->${report.observations.ordinaryPrecedence.forceExcluded.extensionFlag}`,
    );
    console.log(
      `project_delta_empty=extension:${report.observations.projectDeltaEmpty.resources.extensionFlag}`,
    );
    console.log(
      `project_delta_disabled=extension:${report.observations.projectDeltaDisabled.resources.extensionFlag},other:1`,
    );
    console.log(`update=${versionA}->${report.observations.updatedB.installedVersion}`);
    console.log(
      `project_remove=list:${report.observations.projectRemoved.listProject},path:${Number(report.observations.projectRemoved.projectInstalled)},extension:${report.observations.projectRemoved.resources.extensionFlag}`,
    );
    console.log(
      `user_remove=list:${report.observations.userRemoved.listUser},path:${Number(report.observations.userRemoved.userInstalled)},resources:${report.observations.userRemoved.resources.extensionFlag + report.observations.userRemoved.resources.skill + report.observations.userRemoved.resources.prompt + report.observations.userRemoved.resources.theme}`,
    );
    console.log(
      `reinstall=${report.observations.reinstalledB.installedVersion},resources:${report.observations.reinstalledB.resources.extensionFlag + report.observations.reinstalledB.resources.skill + report.observations.reinstalledB.resources.prompt + report.observations.reinstalledB.resources.theme}`,
    );
    console.log(`registry_requests=${report.registryRequests}`);
    console.log(`temp_residuals=${report.tempResiduals}`);
    console.log(`result=${report.result}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
