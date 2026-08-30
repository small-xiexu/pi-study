import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type ToolCall,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { TaskConsoleController } from "../task-console-controller.ts";
import {
  createTaskResourceLoader,
  ensurePrivateSessionDirectory,
  SdkTaskConsoleRuntime,
} from "../task-console-runtime.ts";
import type { ConsoleRecord } from "../safe-output.ts";

const EMPTY_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistantMessage(
  model: Model<Api>,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason,
    timestamp: Date.now(),
  };
}

function readToolStream(model: Model<Api>): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const toolCall: ToolCall = {
    type: "toolCall",
    id: "task-console-read-1",
    name: "read",
    arguments: { path: "fixture.txt" },
  };
  const pending = assistantMessage(model, [toolCall], "pending");
  const complete = assistantMessage(model, [toolCall], "toolUse");
  stream.push({ type: "start", partial: pending });
  stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
  stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: complete });
  stream.push({ type: "done", reason: "toolUse", message: complete });
  stream.end(complete);
  return stream;
}

function textStream(model: Model<Api>, text: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const pending = assistantMessage(model, [{ type: "text", text: "" }], "pending");
  const complete = assistantMessage(model, [{ type: "text", text }], "stop");
  stream.push({ type: "start", partial: pending });
  stream.push({ type: "text_start", contentIndex: 0, partial: pending });
  stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: complete });
  stream.push({ type: "text_end", contentIndex: 0, content: text, partial: complete });
  stream.push({ type: "done", reason: "stop", message: complete });
  stream.end(complete);
  return stream;
}

test("runs a persisted two-turn read loop with the real SDK and no network", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.7-integration-"));
  const cwd = path.join(root, "project");
  const agentDirectory = path.join(root, "agent");
  const sessionDirectory = path.join(root, "private-sessions");
  const records: ConsoleRecord[] = [];
  const answers: string[] = [];
  let requestCount = 0;

  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(agentDirectory, { recursive: true });
    await writeFile(path.join(cwd, "AGENTS.md"), "Use only the read tool.\n");
    await writeFile(path.join(cwd, "fixture.txt"), "TASK_CONSOLE_INTEGRATION_7701\n");
    await ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot: cwd });

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, provider: { maxRetries: 0 } },
    });
    const resourceLoader = await createTaskResourceLoader({
      cwd,
      agentDirectory,
      settingsManager,
    });
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });
    modelRuntime.registerProvider("openai", {
      name: "Pi Study Task Console Test",
      api: "openai-responses",
      baseUrl: "http://127.0.0.1",
      apiKey: "pi-study-local-only",
      streamSimple: (model) => {
        requestCount += 1;
        return requestCount === 1
          ? readToolStream(model)
          : textStream(model, "TASK_CONSOLE_INTEGRATION_7701");
      },
      models: [
        {
          id: "gpt-5.6-sol",
          name: "Task Console Test Model",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 1024,
        },
      ],
    });
    const model = modelRuntime.getModel("openai", "gpt-5.6-sol");
    assert.ok(model);

    const sessionManager = SessionManager.create(cwd, sessionDirectory);
    const created = await createAgentSession({
      cwd,
      agentDir: agentDirectory,
      model,
      thinkingLevel: "off",
      modelRuntime,
      resourceLoader,
      tools: ["read"],
      sessionManager,
      settingsManager,
    });
    const runtime = new SdkTaskConsoleRuntime({
      repositoryRoot: cwd,
      sessionDirectory,
      createSdkContext: async () => ({
        session: created.session,
        sessionManager,
        readyInfo: {
          session: "NEW",
          model: `${model.provider}/${model.id}`,
          tools: created.session.getActiveToolNames(),
        },
      }),
    });
    const controller = new TaskConsoleController(runtime, {
      onRecord: (record) => records.push(record),
      onAnswer: (answer) => answers.push(answer),
    });

    await controller.start();
    assert.equal(await controller.handleLine("read the fixture"), "STARTED");
    await controller.waitForIdle();
    await controller.handleLine("/quit");

    assert.equal(requestCount, 2);
    assert.deepEqual(created.session.getActiveToolNames(), ["read"]);
    assert.deepEqual(answers, ["TASK_CONSOLE_INTEGRATION_7701"]);
    assert.equal(records.some((record) => record.status === "READING"), true);
    assert.equal(
      records.some((record) => record.status === "COMPLETED" && record.saved),
      true,
    );
    assert.equal(
      sessionManager
        .getEntries()
        .some((entry) => entry.type === "message" && entry.message.role === "toolResult"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
