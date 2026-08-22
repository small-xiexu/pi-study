import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const jsonMode = process.argv.includes("--json");
const runnerDir = path.dirname(fileURLToPath(import.meta.url));
const labRoot = path.resolve(runnerDir, "..");
const packageSource = path.join(labRoot, "package");
const packageName = "pi-study-package-security-lab";
const packageVersion = "1.0.0";
const tempPrefix = path.join(os.tmpdir(), "pi-study-6.2-package-security-");

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
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

function minimalNpmEnvironment({
  homeDir,
  cacheDir,
  registryUrl,
  markerDir,
  ignoreScripts,
}) {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: homeDir,
    TMPDIR: os.tmpdir(),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    CI: "1",
    NO_COLOR: "1",
    TERM: "dumb",
    PI_STUDY_62_MARKER_DIR: markerDir,
    NPM_CONFIG_REGISTRY: registryUrl,
    NPM_CONFIG_CACHE: cacheDir,
    NPM_CONFIG_USERCONFIG: path.join(homeDir, ".npmrc"),
    NPM_CONFIG_IGNORE_SCRIPTS: ignoreScripts ? "true" : "false",
    NPM_CONFIG_FOREGROUND_SCRIPTS: "true",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FETCH_RETRIES: "0",
    NPM_CONFIG_FETCH_TIMEOUT: "10000",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  };
}

async function packPackage(tempRoot) {
  const tarballsDir = path.join(tempRoot, "tarballs");
  const homeDir = path.join(tempRoot, "pack-home");
  const cacheDir = path.join(tempRoot, "pack-cache");
  const markerDir = path.join(tempRoot, "pack-markers");
  await Promise.all(
    [tarballsDir, homeDir, cacheDir, markerDir].map((dir) =>
      mkdir(dir, { recursive: true, mode: 0o700 }),
    ),
  );

  const { stdout } = await run(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      tarballsDir,
    ],
    {
      cwd: packageSource,
      env: minimalNpmEnvironment({
        homeDir,
        cacheDir,
        registryUrl: "http://127.0.0.1/",
        markerDir,
        ignoreScripts: true,
      }),
    },
  );
  const result = JSON.parse(stdout)[0];
  if (!result?.filename || !Array.isArray(result.files)) {
    throw new Error(`npm pack did not report a complete result: ${stdout}`);
  }
  const filePath = path.join(tarballsDir, result.filename);
  const data = await readFile(filePath);
  return {
    filename: result.filename,
    files: result.files.map((file) => file.path).sort(),
    data,
    shasum: createHash("sha1").update(data).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(data).digest("base64")}`,
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

async function startRegistry(tarball, packageManifest) {
  const requests = [];
  let registryUrl;
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);
    requests.push({ method: request.method ?? "GET", pathname });

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "method_not_allowed" }, '"method"');
      return;
    }

    if (pathname === `/${packageName}`) {
      sendJson(
        response,
        200,
        {
          _id: packageName,
          name: packageName,
          "dist-tags": { latest: packageVersion },
          versions: {
            [packageVersion]: {
              ...packageManifest,
              dist: {
                tarball: `${registryUrl}${packageName}/-/${tarball.filename}`,
                shasum: tarball.shasum,
                integrity: tarball.integrity,
              },
            },
          },
        },
        '"package-security"',
      );
      return;
    }

    if (pathname === `/${packageName}/-/${tarball.filename}`) {
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
  return { server, registryUrl, requests };
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

async function createScope(tempRoot, name, registryUrl, ignoreScripts) {
  const scopeRoot = path.join(tempRoot, name);
  const agentDir = path.join(scopeRoot, "agent");
  const homeDir = path.join(scopeRoot, "home");
  const cacheDir = path.join(scopeRoot, "npm-cache");
  const projectDir = path.join(scopeRoot, "project");
  const markerDir = path.join(scopeRoot, "markers");
  await Promise.all(
    [agentDir, homeDir, cacheDir, projectDir, markerDir].map((dir) =>
      mkdir(dir, { recursive: true, mode: 0o700 }),
    ),
  );
  return {
    agentDir,
    markerDir,
    projectDir,
    env: {
      ...minimalNpmEnvironment({
        homeDir,
        cacheDir,
        registryUrl,
        markerDir,
        ignoreScripts,
      }),
      PI_CODING_AGENT_DIR: agentDir,
      GIT_TERMINAL_PROMPT: "0",
    },
  };
}

async function runPi(args, scope) {
  return run(process.env.PI_BIN ?? "pi", args, {
    cwd: scope.projectDir,
    env: scope.env,
  });
}

async function startPi(scope) {
  await runPi(
    [
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
}

async function markerExists(scope, filename) {
  try {
    await access(path.join(scope.markerDir, filename));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readLoadCount(scope) {
  try {
    const value = Number.parseInt(
      await readFile(path.join(scope.markerDir, "load-count.txt"), "utf8"),
      10,
    );
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Invalid load marker count");
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function readConfiguredSource(scope) {
  const settings = JSON.parse(
    await readFile(path.join(scope.agentDir, "settings.json"), "utf8"),
  );
  if (!Array.isArray(settings.packages) || settings.packages.length !== 1) {
    throw new Error("Expected exactly one Package in isolated user settings");
  }
  const entry = settings.packages[0];
  const source = typeof entry === "string" ? entry : entry?.source;
  if (typeof source !== "string") {
    throw new Error("Isolated settings do not contain a Package Source");
  }
  return { settings, source };
}

async function disableExtension(scope, expectedSource) {
  const settingsPath = path.join(scope.agentDir, "settings.json");
  const { settings, source } = await readConfiguredSource(scope);
  if (source !== expectedSource) {
    throw new Error(`Unexpected Package Source before filtering: ${source}`);
  }
  settings.packages = [{ source, extensions: [] }];
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function rebuildPackage(scope) {
  await run(
    "npm",
    ["rebuild", packageName, "--ignore-scripts=false", "--foreground-scripts"],
    {
      cwd: path.join(scope.agentDir, "npm"),
      env: {
        ...scope.env,
        NPM_CONFIG_IGNORE_SCRIPTS: "false",
      },
    },
  );
}

function dependencyNames(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
}

function bundledDependencyNames(manifest) {
  const bundled = manifest.bundledDependencies ?? manifest.bundleDependencies;
  return Array.isArray(bundled) ? [...bundled].sort() : [];
}

function createStaticAudit(manifest, tarball) {
  const lifecycleOrder = ["preinstall", "install", "postinstall", "prepare"];
  return {
    tarballFiles: tarball.files,
    dependencies: dependencyNames(manifest.dependencies),
    peerDependencies: dependencyNames(manifest.peerDependencies),
    bundledDependencies: bundledDependencyNames(manifest),
    devDependencies: dependencyNames(manifest.devDependencies),
    lifecycleScripts: lifecycleOrder.filter(
      (name) => typeof manifest.scripts?.[name] === "string",
    ),
    extensionEntries: Array.isArray(manifest.pi?.extensions)
      ? [...manifest.pi.extensions]
      : [],
  };
}

async function runLab() {
  const tempRoot = await mkdtemp(tempPrefix);
  let registry;
  try {
    const packageManifest = JSON.parse(
      await readFile(path.join(packageSource, "package.json"), "utf8"),
    );
    const tarball = await packPackage(tempRoot);
    const staticAudit = createStaticAudit(packageManifest, tarball);
    registry = await startRegistry(tarball, packageManifest);
    const defaultScope = await createScope(
      tempRoot,
      "scope-default",
      registry.registryUrl,
      false,
    );
    const controlledScope = await createScope(
      tempRoot,
      "scope-controlled",
      registry.registryUrl,
      true,
    );
    const source = `npm:${packageName}@${packageVersion}`;

    await runPi(["install", source], defaultScope);
    const configuredDefault = await readConfiguredSource(defaultScope);
    const observationA = {
      installMarker: await markerExists(defaultScope, "install-marker.txt"),
      loadBeforeStart: await readLoadCount(defaultScope),
      loadAfterStart: 0,
    };
    await startPi(defaultScope);
    observationA.loadAfterStart = await readLoadCount(defaultScope);

    await runPi(["install", source], controlledScope);
    const configuredControlled = await readConfiguredSource(controlledScope);
    const observationB = {
      installMarker: await markerExists(controlledScope, "install-marker.txt"),
      loadBeforeStart: await readLoadCount(controlledScope),
      loadAfterStart: 0,
    };
    await startPi(controlledScope);
    observationB.loadAfterStart = await readLoadCount(controlledScope);

    const observationC = {
      installMarker: false,
      loadBeforeRebuild: await readLoadCount(controlledScope),
      loadAfterRebuild: 0,
    };
    await rebuildPackage(controlledScope);
    observationC.installMarker = await markerExists(
      controlledScope,
      "install-marker.txt",
    );
    observationC.loadAfterRebuild = await readLoadCount(controlledScope);

    const observationD = {
      installMarker: await markerExists(controlledScope, "install-marker.txt"),
      loadBeforeDisabledStart: await readLoadCount(controlledScope),
      loadAfterDisabledStart: 0,
    };
    await disableExtension(controlledScope, source);
    await startPi(controlledScope);
    observationD.loadAfterDisabledStart = await readLoadCount(controlledScope);

    if (
      configuredDefault.source !== source ||
      configuredControlled.source !== source
    ) {
      throw new Error("Pi did not preserve the exact Package Source");
    }

    const observations = {
      A: observationA,
      B: observationB,
      C: observationC,
      D: observationD,
    };
    const expectedStaticAudit = {
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
    };
    const expectedObservations = {
      A: { installMarker: true, loadBeforeStart: 0, loadAfterStart: 1 },
      B: { installMarker: false, loadBeforeStart: 0, loadAfterStart: 1 },
      C: { installMarker: true, loadBeforeRebuild: 1, loadAfterRebuild: 1 },
      D: {
        installMarker: true,
        loadBeforeDisabledStart: 1,
        loadAfterDisabledStart: 1,
      },
    };
    const result =
      JSON.stringify(staticAudit) === JSON.stringify(expectedStaticAudit) &&
      JSON.stringify(observations) === JSON.stringify(expectedObservations)
        ? "PASS"
        : "FAIL";
    const report = {
      network: "loopback-only",
      host: "127.0.0.1",
      packageName,
      version: packageVersion,
      staticAudit,
      observations,
      registryRequests: registry.requests.length,
      result,
    };
    if (result !== "PASS") {
      throw new Error(`Unexpected Package security observations: ${JSON.stringify(report)}`);
    }
    return report;
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
}

try {
  const report = await runLab();
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    console.log(`network=${report.network}`);
    console.log(`host=${report.host}`);
    console.log(`package_name=${report.packageName}`);
    console.log(`version=${report.version}`);
    console.log(`tarball_files=${report.staticAudit.tarballFiles.join(",")}`);
    console.log(`a_install_marker=${report.observations.A.installMarker}`);
    console.log(`a_load=${report.observations.A.loadBeforeStart}->${report.observations.A.loadAfterStart}`);
    console.log(`b_install_marker=${report.observations.B.installMarker}`);
    console.log(`b_load=${report.observations.B.loadBeforeStart}->${report.observations.B.loadAfterStart}`);
    console.log(`c_install_marker=${report.observations.C.installMarker}`);
    console.log(`c_load=${report.observations.C.loadBeforeRebuild}->${report.observations.C.loadAfterRebuild}`);
    console.log(`d_install_marker=${report.observations.D.installMarker}`);
    console.log(`d_load=${report.observations.D.loadBeforeDisabledStart}->${report.observations.D.loadAfterDisabledStart}`);
    console.log(`registry_requests=${report.registryRequests}`);
    console.log(`result=${report.result}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
