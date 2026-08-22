import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const jsonMode = process.argv.includes("--json");
const packageName = "pi-study-npm-source-lab";
const versionA = "1.0.0";
const versionB = "1.1.0";
const tempPrefix = path.join(os.tmpdir(), "pi-study-6.1-npm-");

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

function extensionSource(marker) {
  return `export default function registerNpmMarker(pi) {
  pi.registerFlag("pi-study-npm-marker", {
    description: "PI_STUDY_NPM_${marker}",
    type: "boolean",
    default: false,
  });
}
`;
}

async function createPackageSource(root, version, marker) {
  const packageRoot = path.join(root, `package-${marker.toLowerCase()}`);
  const extensionDir = path.join(packageRoot, "extensions");
  await mkdir(extensionDir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: packageName,
        version,
        type: "module",
        description: `Pi Study npm source marker ${marker}`,
        keywords: ["pi-package"],
        files: ["extensions"],
        pi: {
          extensions: ["./extensions/source-marker.js"],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(extensionDir, "source-marker.js"),
    extensionSource(marker),
    "utf8",
  );
  return packageRoot;
}

function minimalNpmEnvironment(homeDir, cacheDir, registryUrl) {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: homeDir,
    TMPDIR: cacheDir,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    CI: "1",
    NO_COLOR: "1",
    TERM: "dumb",
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

async function packPackage(packageRoot, tarballsDir, packHome, packCache) {
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
      cwd: packageRoot,
      env: minimalNpmEnvironment(packHome, packCache, "http://127.0.0.1/"),
    },
  );
  const result = JSON.parse(stdout);
  const filename = result[0]?.filename;
  if (!filename) {
    throw new Error(`npm pack did not report a tarball filename: ${stdout}`);
  }
  const filePath = path.join(tarballsDir, filename);
  const data = await readFile(filePath);
  return {
    filename,
    data,
    shasum: createHash("sha1").update(data).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(data).digest("base64")}`,
  };
}

function packageManifest(version, tarball, registryUrl) {
  return {
    name: packageName,
    version,
    type: "module",
    description: `Pi Study npm source marker ${version === versionA ? "A" : "B"}`,
    keywords: ["pi-package"],
    pi: {
      extensions: ["./extensions/source-marker.js"],
    },
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

async function startRegistry(tarballA, tarballB) {
  let publishedB = false;
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
      const versions = {
        [versionA]: packageManifest(versionA, tarballA, registryUrl),
      };
      if (publishedB) {
        versions[versionB] = packageManifest(versionB, tarballB, registryUrl);
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
        publishedB ? '"registry-b"' : '"registry-a"',
      );
      return;
    }

    const tarballs = new Map([
      [`/${packageName}/-/${tarballA.filename}`, tarballA],
      [`/${packageName}/-/${tarballB.filename}`, publishedB ? tarballB : undefined],
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
  if (!server?.listening) {
    return;
  }
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

async function createScope(root, name, registryUrl) {
  const scopeRoot = path.join(root, name);
  const agentDir = path.join(scopeRoot, "agent");
  const homeDir = path.join(scopeRoot, "home");
  const cacheDir = path.join(scopeRoot, "npm-cache");
  const projectDir = path.join(scopeRoot, "project");
  await Promise.all(
    [agentDir, homeDir, cacheDir, projectDir].map((dir) =>
      mkdir(dir, { recursive: true, mode: 0o700 }),
    ),
  );
  return {
    agentDir,
    projectDir,
    env: {
      ...minimalNpmEnvironment(homeDir, cacheDir, registryUrl),
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

async function observePiMarker(scope) {
  const { stdout, stderr } = await runPi(
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
  const output = `${stdout}\n${stderr}`;
  const seenA = output.includes("PI_STUDY_NPM_A");
  const seenB = output.includes("PI_STUDY_NPM_B");
  if (seenA === seenB) {
    const diagnostic =
      output.length <= 12_000
        ? output
        : `${output.slice(0, 6_000)}\n... output truncated ...\n${output.slice(-6_000)}`;
    throw new Error(
      `Expected exactly one npm marker; seenA=${seenA} seenB=${seenB}\nPi output:\n${diagnostic}`,
    );
  }
  return seenA ? "A" : "B";
}

async function readInstalledVersion(scope) {
  const packageJsonPath = path.join(
    scope.agentDir,
    "npm",
    "node_modules",
    packageName,
    "package.json",
  );
  const manifest = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (typeof manifest.version !== "string") {
    throw new Error("Installed npm Package does not expose a string version");
  }
  return manifest.version;
}

async function readConfiguredSource(scope) {
  const settingsPath = path.join(scope.agentDir, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  if (!Array.isArray(settings.packages) || settings.packages.length !== 1) {
    throw new Error("Expected exactly one Package in isolated user settings");
  }
  const entry = settings.packages[0];
  const source = typeof entry === "string" ? entry : entry?.source;
  if (typeof source !== "string") {
    throw new Error("Isolated user settings do not contain a Package Source");
  }
  return source;
}

async function observe(scope) {
  return {
    marker: await observePiMarker(scope),
    version: await readInstalledVersion(scope),
  };
}

async function runLab() {
  const tempRoot = await mkdtemp(tempPrefix);
  const tarballsDir = path.join(tempRoot, "tarballs");
  const packHome = path.join(tempRoot, "pack-home");
  const packCache = path.join(tempRoot, "pack-cache");
  let registry;

  try {
    await Promise.all(
      [tarballsDir, packHome, packCache].map((dir) =>
        mkdir(dir, { recursive: true, mode: 0o700 }),
      ),
    );
    const packageA = await createPackageSource(tempRoot, versionA, "A");
    const packageB = await createPackageSource(tempRoot, versionB, "B");
    const tarballA = await packPackage(
      packageA,
      tarballsDir,
      packHome,
      packCache,
    );
    const tarballB = await packPackage(
      packageB,
      tarballsDir,
      packHome,
      packCache,
    );

    registry = await startRegistry(tarballA, tarballB);
    const exactScope = await createScope(
      tempRoot,
      "scope-exact",
      registry.registryUrl,
    );
    const rangeScope = await createScope(
      tempRoot,
      "scope-range",
      registry.registryUrl,
    );
    const exactSource = `npm:${packageName}@${versionA}`;
    const rangeSource = `npm:${packageName}@^1.0.0`;

    await runPi(["install", exactSource], exactScope);
    await runPi(["install", rangeSource], rangeScope);
    const configuredExact = await readConfiguredSource(exactScope);
    const configuredRange = await readConfiguredSource(rangeScope);
    const exactBeforeUpdate = await observe(exactScope);
    const rangeBeforeUpdate = await observe(rangeScope);

    registry.publishB();
    await runPi(["update", "--extensions"], exactScope);
    await runPi(["update", "--extensions"], rangeScope);
    const exactAfterUpdate = await observe(exactScope);
    const rangeAfterUpdate = await observe(rangeScope);
    const configuredExactAfterUpdate = await readConfiguredSource(exactScope);
    const configuredRangeAfterUpdate = await readConfiguredSource(rangeScope);

    if (
      configuredExact !== exactSource ||
      configuredRange !== rangeSource ||
      configuredExactAfterUpdate !== exactSource ||
      configuredRangeAfterUpdate !== rangeSource
    ) {
      throw new Error(
        `Unexpected isolated Settings Sources: ${JSON.stringify({
          configuredExact,
          configuredRange,
          configuredExactAfterUpdate,
          configuredRangeAfterUpdate,
        })}`,
      );
    }

    const observations = {
      exactBeforeUpdate,
      rangeBeforeUpdate,
      exactAfterUpdate,
      rangeAfterUpdate,
    };
    const result =
      JSON.stringify(observations) ===
      JSON.stringify({
        exactBeforeUpdate: { marker: "A", version: versionA },
        rangeBeforeUpdate: { marker: "A", version: versionA },
        exactAfterUpdate: { marker: "A", version: versionA },
        rangeAfterUpdate: { marker: "B", version: versionB },
      })
        ? "PASS"
        : "FAIL";

    const report = {
      network: "loopback-only",
      host: "127.0.0.1",
      packageName,
      versions: { A: versionA, B: versionB },
      sources: { exact: configuredExact, range: configuredRange },
      observations,
      registryRequests: registry.requests.length,
      result,
    };
    if (result !== "PASS") {
      throw new Error(`Unexpected npm source observations: ${JSON.stringify(report)}`);
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
    console.log(`version_a=${report.versions.A}`);
    console.log(`version_b=${report.versions.B}`);
    console.log(`exact_source=${report.sources.exact}`);
    console.log(`range_source=${report.sources.range}`);
    console.log(
      `exact_before_update=${report.observations.exactBeforeUpdate.marker}@${report.observations.exactBeforeUpdate.version}`,
    );
    console.log(
      `range_before_update=${report.observations.rangeBeforeUpdate.marker}@${report.observations.rangeBeforeUpdate.version}`,
    );
    console.log(
      `exact_after_update=${report.observations.exactAfterUpdate.marker}@${report.observations.exactAfterUpdate.version}`,
    );
    console.log(
      `range_after_update=${report.observations.rangeAfterUpdate.marker}@${report.observations.rangeAfterUpdate.version}`,
    );
    console.log(`registry_requests=${report.registryRequests}`);
    console.log(`result=${report.result}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
