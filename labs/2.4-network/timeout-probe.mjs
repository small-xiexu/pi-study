#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROVIDER_ID = "local-timeout-probe";
const MODEL_ID = "timeout-probe";
const REQUEST_TIMEOUT_MS = 400;
const OUTER_WATCHDOG_MS = 8_000;

function printStep(number, message) {
  console.log(`\n[${number}/4] ${message}`);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function resolvePiExecutable() {
  if (process.env.PI_BIN) {
    return process.env.PI_BIN;
  }

  const homebrewPi = "/opt/homebrew/bin/pi";
  try {
    await access(homebrewPi, constants.X_OK);
    return homebrewPi;
  } catch {
    return "pi";
  }
}

async function startFakeProvider(onFirstRequest) {
  let requestCount = 0;
  let firstRequest;
  const openResponses = new Set();
  const openSockets = new Set();

  const server = createServer((request, response) => {
    requestCount += 1;
    firstRequest ??= {
      method: request.method,
      url: request.url,
    };

    request.resume();
    openResponses.add(response);
    response.on("close", () => openResponses.delete(response));

    if (requestCount === 1) {
      onFirstRequest();
    }

    // 故意不返回 headers 或 body，让 Pi 的单次请求超时负责终止等待。
  });

  server.on("connection", (socket) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("无法取得本机假 Provider 的监听端口");
  }

  return {
    port: address.port,
    get requestCount() {
      return requestCount;
    },
    get firstRequest() {
      return firstRequest;
    },
    async close() {
      for (const response of openResponses) {
        response.destroy();
      }
      for (const socket of openSockets) {
        socket.destroy();
      }

      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function createChildEnvironment(agentDir, temporaryHome) {
  const environment = {
    ...process.env,
    HOME: temporaryHome,
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    NO_COLOR: "1",
    TERM: "dumb",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: "127.0.0.1,localhost",
  };

  // 实验使用 models.json 中的假 Key，不把当前 Shell 的真实凭据交给子进程。
  for (const key of Object.keys(environment)) {
    if (/(_API_KEY|_ACCESS_TOKEN|_AUTH_TOKEN|_SECRET)$/i.test(key)) {
      delete environment[key];
    }
  }

  return environment;
}

function runPi(piExecutable, workingDirectory, environment) {
  const argumentsList = [
    "--no-approve",
    "--no-context-files",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-tools",
    "--no-session",
    "--offline",
    "--model",
    `${PROVIDER_ID}/${MODEL_ID}`,
    "--print",
    "只回复 OK",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(piExecutable, argumentsList, {
      cwd: workingDirectory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let watchdogTriggered = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const watchdog = setTimeout(() => {
      watchdogTriggered = true;
      child.kill("SIGTERM");
    }, OUTER_WATCHDOG_MS);

    child.once("error", (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(watchdog);
      resolve({ exitCode, signal, stdout, stderr, watchdogTriggered });
    });
  });
}

function printCheck(label, passed, detail) {
  const status = passed ? "PASS" : "FAIL";
  console.log(`${status.padEnd(4)}  ${label}: ${detail}`);
}

async function main() {
  console.log("Pi Network 单次请求超时实验");
  console.log("目标：证明 retry.provider.timeoutMs 限制一次 Model 请求，而不是整个 Run。");

  const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-network-timeout-"));
  const agentDir = join(temporaryRoot, "agent");
  const temporaryHome = join(temporaryRoot, "home");
  let fakeProvider;

  try {
    await mkdir(agentDir, { recursive: true });
    await mkdir(temporaryHome, { recursive: true });

    printStep(1, "启动本机假 Provider");
    fakeProvider = await startFakeProvider(() => {
      printStep(3, "假 Provider 收到请求，但故意不响应");
    });

    await writeJson(join(agentDir, "models.json"), {
      providers: {
        [PROVIDER_ID]: {
          baseUrl: `http://127.0.0.1:${fakeProvider.port}/v1`,
          api: "openai-completions",
          apiKey: "local-dummy-key",
          models: [
            {
              id: MODEL_ID,
              name: "Local Timeout Probe",
              reasoning: false,
              input: ["text"],
              contextWindow: 4096,
              maxTokens: 256,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
            },
          ],
        },
      },
    });

    await writeJson(join(agentDir, "settings.json"), {
      defaultProvider: PROVIDER_ID,
      defaultModel: MODEL_ID,
      httpIdleTimeoutMs: 5_000,
      retry: {
        enabled: false,
        maxRetries: 0,
        provider: {
          timeoutMs: REQUEST_TIMEOUT_MS,
          maxRetries: 0,
          maxRetryDelayMs: 1_000,
        },
      },
    });

    const piExecutable = await resolvePiExecutable();
    const environment = createChildEnvironment(agentDir, temporaryHome);

    printStep(2, `Pi 发出 Model 请求（单次上限 ${REQUEST_TIMEOUT_MS} ms）`);
    const startedAt = Date.now();
    const result = await runPi(piExecutable, temporaryRoot, environment);
    const elapsedMs = Date.now() - startedAt;

    printStep(4, "Pi 进程退出，核对它为什么退出");

    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const timeoutLine = combinedOutput
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /timed out|timeout|aborted/i.test(line));
    const requestStayedLocal =
      fakeProvider.firstRequest?.method === "POST" &&
      fakeProvider.firstRequest?.url?.startsWith("/v1/");

    const checks = [
      {
        label: "请求到达本机假 Provider",
        passed: requestStayedLocal,
        detail: fakeProvider.firstRequest
          ? `${fakeProvider.firstRequest.method} ${fakeProvider.firstRequest.url}`
          : "没有收到请求",
      },
      {
        label: "Pi 因超时而退出",
        passed: result.exitCode !== 0 && Boolean(timeoutLine),
        detail: timeoutLine ?? `未找到超时信息，exitCode=${result.exitCode}`,
      },
      {
        label: "两层重试均已关闭",
        passed: fakeProvider.requestCount === 1,
        detail: `Provider 共收到 ${fakeProvider.requestCount} 次请求`,
      },
      {
        label: "外层安全看门狗没有介入",
        passed: !result.watchdogTriggered,
        detail: `Pi 子进程用时 ${elapsedMs} ms`,
      },
    ];

    for (const check of checks) {
      printCheck(check.label, check.passed, check.detail);
    }

    console.log("\n安全边界：临时目录 + 本机 127.0.0.1 + 假 API Key；未访问真实 Provider。");

    if (checks.every((check) => check.passed)) {
      console.log("\n实验结果：PASS");
      console.log("结论：这次只验证了单次 Model 请求超时；没有验证整个 Run 的总时限。");
      return;
    }

    console.error("\n实验结果：FAIL");
    console.error("下面保留 Pi 原始输出，便于定位失败原因：");
    console.error(combinedOutput.trim() || "（Pi 没有输出）");
    process.exitCode = 1;
  } finally {
    await fakeProvider?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\n实验无法完成：${error.message}`);
  process.exitCode = 1;
});
