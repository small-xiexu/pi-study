import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const jsonMode = process.argv.includes("--json");
const tempPrefix = path.join(os.tmpdir(), "pi-study-6.1-git-");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

function runGit(args, cwd) {
  return run("git", args, { cwd });
}

function markerSource(marker) {
  const lower = marker.toLowerCase();
  return `export default function registerGitMarker(pi) {
  pi.registerFlag("pi-study-git-${lower}", {
    description: "PI_STUDY_GIT_${marker}",
    type: "boolean",
    default: false,
  });
}
`;
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) {
    throw new Error("Unable to reserve a loopback port");
  }
  return port;
}

function connectToLoopback(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
  });
}

async function waitForDaemon(child, port, getLogs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`git daemon exited early\n${getLogs()}`);
    }
    try {
      await connectToLoopback(port);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`git daemon did not become ready\n${getLogs()}`);
}

async function startGitDaemon(repositoriesRoot, port) {
  const child = spawn(
    "git",
    [
      "daemon",
      "--reuseaddr",
      "--export-all",
      "--verbose",
      "--listen=127.0.0.1",
      `--port=${port}`,
      `--base-path=${repositoriesRoot}`,
      repositoriesRoot,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-8_000);
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });

  const getLogs = () => `stdout:\n${stdout}\nstderr:\n${stderr}`;
  await waitForDaemon(child, port, getLogs);
  return child;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const waitForExit = (timeoutMs) =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(true);
        return;
      }

      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      child.once("exit", onExit);
    });

  child.kill("SIGTERM");
  const exited = await waitForExit(2_000);

  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    const killed = await waitForExit(2_000);
    if (!killed && child.exitCode === null && child.signalCode === null) {
      throw new Error("git daemon did not stop after SIGKILL");
    }
  }
}

function observePiMarker(source, agentDir, projectDir) {
  const result = spawnSync(
    process.env.PI_BIN ?? "pi",
    [
      "-e",
      source,
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-tools",
      "--help",
    ],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        GIT_TERMINAL_PROMPT: "0",
        NO_COLOR: "1",
        TERM: "dumb",
      },
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `pi --help failed with exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  const output = `${result.stdout}\n${result.stderr}`;

  const seenA = output.includes("PI_STUDY_GIT_A");
  const seenB = output.includes("PI_STUDY_GIT_B");
  if (seenA === seenB) {
    const diagnosticOutput =
      output.length <= 12_000
        ? output
        : `${output.slice(0, 6_000)}\n... output truncated ...\n${output.slice(-6_000)}`;
    throw new Error(
      `Expected exactly one Git marker for ${source}; seenA=${seenA} seenB=${seenB}\nPi output:\n${diagnosticOutput}`,
    );
  }
  return seenA ? "A" : "B";
}

async function runLab() {
  const tempRoot = await mkdtemp(tempPrefix);
  const repositoriesRoot = path.join(tempRoot, "repositories");
  const bareRepository = path.join(
    repositoriesRoot,
    "pi-study",
    "package.git",
  );
  const worktree = path.join(tempRoot, "worktree");
  const extensionDir = path.join(worktree, "extensions");
  const extensionFile = path.join(extensionDir, "source-marker.js");
  const cachedAgentDir = path.join(tempRoot, "agent-cached-branch");
  const freshBranchAgentDir = path.join(tempRoot, "agent-fresh-branch");
  const commitAgentDir = path.join(tempRoot, "agent-commit-a");
  const projectDir = path.join(tempRoot, "project");
  let daemon;

  try {
    await mkdir(path.dirname(bareRepository), { recursive: true, mode: 0o700 });
    await mkdir(extensionDir, { recursive: true, mode: 0o700 });
    await mkdir(cachedAgentDir, { recursive: true, mode: 0o700 });
    await mkdir(freshBranchAgentDir, { recursive: true, mode: 0o700 });
    await mkdir(commitAgentDir, { recursive: true, mode: 0o700 });
    await mkdir(projectDir, { recursive: true, mode: 0o700 });

    runGit(["init", "--bare", bareRepository], tempRoot);
    runGit(["init", "-b", "main", worktree], tempRoot);
    await writeFile(extensionFile, markerSource("A"), "utf8");
    runGit(["add", "extensions/source-marker.js"], worktree);
    runGit(
      [
        "-c",
        "user.name=Pi Study",
        "-c",
        "user.email=pi-study@example.invalid",
        "commit",
        "-m",
        "package A",
      ],
      worktree,
    );
    const commitA = runGit(["rev-parse", "HEAD"], worktree);
    runGit(["remote", "add", "origin", bareRepository], worktree);
    runGit(["push", "-u", "origin", "main"], worktree);
    runGit(["--git-dir", bareRepository, "symbolic-ref", "HEAD", "refs/heads/main"], tempRoot);

    const port = await reserveLoopbackPort();
    daemon = await startGitDaemon(repositoriesRoot, port);
    const sourceBase = `git:git://127.0.0.1:${port}/pi-study/package.git`;
    const branchSource = `${sourceBase}@main`;
    const branchBeforeMove = observePiMarker(
      branchSource,
      cachedAgentDir,
      projectDir,
    );

    await writeFile(extensionFile, markerSource("B"), "utf8");
    runGit(["add", "extensions/source-marker.js"], worktree);
    runGit(
      [
        "-c",
        "user.name=Pi Study",
        "-c",
        "user.email=pi-study@example.invalid",
        "commit",
        "-m",
        "package B",
      ],
      worktree,
    );
    const commitB = runGit(["rev-parse", "HEAD"], worktree);
    runGit(["push", "origin", "main"], worktree);

    const cachedBranchAfterMove = observePiMarker(
      branchSource,
      cachedAgentDir,
      projectDir,
    );
    const freshBranchAfterMove = observePiMarker(
      branchSource,
      freshBranchAgentDir,
      projectDir,
    );
    const commitAAfterBranchMove = observePiMarker(
      `${sourceBase}@${commitA}`,
      commitAgentDir,
      projectDir,
    );

    const report = {
      network: "loopback-only",
      host: "127.0.0.1",
      branchRef: "main",
      commitA,
      commitB,
      observations: {
        branchBeforeMove,
        cachedBranchAfterMove,
        freshBranchAfterMove,
        commitAAfterBranchMove,
      },
      result:
        branchBeforeMove === "A" &&
        cachedBranchAfterMove === "A" &&
        freshBranchAfterMove === "B" &&
        commitAAfterBranchMove === "A"
          ? "PASS"
          : "FAIL",
    };

    if (report.result !== "PASS") {
      throw new Error(`Unexpected Git source observations: ${JSON.stringify(report)}`);
    }
    return report;
  } finally {
    await stopProcess(daemon);
    if (!tempRoot.startsWith(tempPrefix)) {
      throw new Error("Refusing to clean an unexpected temporary path");
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

try {
  const report = await runLab();
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    console.log(`network=${report.network}`);
    console.log(`host=${report.host}`);
    console.log(`branch_ref=${report.branchRef}`);
    console.log(`commit_a=${report.commitA}`);
    console.log(`commit_b=${report.commitB}`);
    console.log(`branch_before_move=${report.observations.branchBeforeMove}`);
    console.log(
      `cached_branch_after_move=${report.observations.cachedBranchAfterMove}`,
    );
    console.log(
      `fresh_branch_after_move=${report.observations.freshBranchAfterMove}`,
    );
    console.log(
      `commit_a_after_branch_move=${report.observations.commitAAfterBranchMove}`,
    );
    console.log(`result=${report.result}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
