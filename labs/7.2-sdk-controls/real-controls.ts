import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PROVIDER_ID = "openai";
const MODEL_ID = "gpt-5.6-sol";
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const agentDirectory = getAgentDir();

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 30_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function textFromAssistant(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

function lastAssistant(messages: readonly unknown[]): AssistantMessage | undefined {
  return [...messages]
    .reverse()
    .find((message): message is AssistantMessage =>
      typeof message === "object" && message !== null && "role" in message && message.role === "assistant",
    );
}

function userMessage(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: PROVIDER_ID,
    model: MODEL_ID,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

async function createResourceLoader(settingsManager: SettingsManager): Promise<DefaultResourceLoader> {
  const resourceLoader = new DefaultResourceLoader({
    cwd: repositoryRoot,
    agentDir: agentDirectory,
    settingsManager,
    noExtensions: true,
  });
  await resourceLoader.reload();
  return resourceLoader;
}

async function selectRealModel(): Promise<{
  modelRuntime: ModelRuntime;
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
}> {
  const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
  const models = await modelRuntime.getAvailable(PROVIDER_ID);
  const model = models.find((candidate) => candidate.id === MODEL_ID);
  if (!model) throw new Error(`Configured model unavailable: ${PROVIDER_ID}/${MODEL_ID}`);
  return { modelRuntime, model };
}

async function runCancellationScenario(
  modelRuntime: ModelRuntime,
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>,
): Promise<void> {
  const started = deferred<void>();
  let signalObserved = false;
  let completed = false;
  const delayTool: ToolDefinition = {
    name: "pi_study_wait_for_abort",
    label: "Wait For Abort",
    description: "Required control experiment tool. Call exactly once and wait for cancellation.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId, _params, signal) {
      started.resolve();
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          signalObserved = true;
          reject(new Error("Operation aborted"));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
      completed = true;
      return { content: [{ type: "text", text: "LATE_COMPLETION" }], details: {} };
    },
  };
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const { session } = await createAgentSession({
    cwd: repositoryRoot,
    agentDir: agentDirectory,
    model,
    modelRuntime,
    thinkingLevel: "off",
    tools: [delayTool.name],
    customTools: [delayTool],
    resourceLoader: await createResourceLoader(settingsManager),
    sessionManager: SessionManager.inMemory(repositoryRoot),
    settingsManager,
  });
  const events: AgentSessionEvent[] = [];
  const unsubscribe = session.subscribe((event) => events.push(event));
  try {
    const promptPromise = session.prompt(
      "Call pi_study_wait_for_abort exactly once. Do not answer before the tool returns.",
    );
    await withTimeout(started.promise, "real cancellation tool start");
    await session.abort();
    await promptPromise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(signalObserved, true);
    assert.equal(completed, false);
    assert.equal(events.filter((event) => event.type === "tool_execution_start").length, 1);
    assert.ok(events.some((event) => event.type === "tool_execution_end" && event.isError));
    assert.equal(events.at(-1)?.type, "agent_settled");
    console.log(JSON.stringify({
      kind: "real_cancel",
      signalObserved,
      lateCompletion: completed,
      settled: events.at(-1)?.type === "agent_settled",
    }));
  } finally {
    unsubscribe();
    session.dispose();
  }
}

async function runQueueCompactionPersistenceScenario(
  modelRuntime: ModelRuntime,
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>,
): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pi-study-72-real-"));
  let activeSession: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let activeUnsubscribe: (() => void) | undefined;
  try {
    const gateStarted = deferred<void>();
    const gateRelease = deferred<void>();
    const gateTool: ToolDefinition = {
      name: "pi_study_release_gate",
      label: "Release Gate",
      description: "Required control experiment tool. Call exactly once before responding.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        gateStarted.resolve();
        await gateRelease.promise;
        return { content: [{ type: "text", text: "GATE_RELEASED" }], details: {} };
      },
    };
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: true, reserveTokens: 1024, keepRecentTokens: 128 },
      retry: { enabled: false },
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    });
    const sessionManager = SessionManager.create(repositoryRoot, temporaryRoot);
    const created = await createAgentSession({
      cwd: repositoryRoot,
      agentDir: agentDirectory,
      model,
      modelRuntime,
      thinkingLevel: "off",
      tools: [gateTool.name],
      customTools: [gateTool],
      resourceLoader: await createResourceLoader(settingsManager),
      sessionManager,
      settingsManager,
    });
    activeSession = created.session;
    const userDeliveries: string[] = [];
    const queueEvents: number[] = [];
    activeUnsubscribe = activeSession.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "user") {
        const text = typeof event.message.content === "string"
          ? event.message.content
          : event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
        userDeliveries.push(text);
      }
      if (event.type === "queue_update") {
        queueEvents.push(event.steering.length + event.followUp.length);
      }
    });
    const promptPromise = activeSession.prompt(
      "Call pi_study_release_gate exactly once. After it returns, acknowledge the queued instructions.",
    );
    await withTimeout(gateStarted.promise, "real queue gate start");
    await activeSession.steer("STEER_MARKER: reply with STEER_ACK before finishing current work.");
    await activeSession.followUp("FOLLOW_MARKER: after current work, reply exactly FOLLOW_ACK.");
    gateRelease.resolve();
    await promptPromise;

    const markerDeliveries = userDeliveries.filter((text) => text.includes("_MARKER"));
    assert.deepEqual(markerDeliveries.map((text) => text.split(":")[0]), ["STEER_MARKER", "FOLLOW_MARKER"]);
    assert.equal(activeSession.pendingMessageCount, 0);
    assert.ok(queueEvents.some((count) => count === 2));

    sessionManager.appendMessage(userMessage(`PERSIST_CONTEXT_MARKER ${"old ".repeat(400)}`));
    sessionManager.appendMessage(assistantMessage(`OLD_REPLY ${"detail ".repeat(400)}`));
    for (let index = 0; index < 8; index++) {
      sessionManager.appendMessage(userMessage(`RECENT_USER_${index} ${"recent ".repeat(80)}`));
      sessionManager.appendMessage(assistantMessage(`RECENT_ASSISTANT_${index} ${"answer ".repeat(80)}`));
    }
    const compactionReasons: string[] = [];
    const compactionUnsubscribe = activeSession.subscribe((event) => {
      if (event.type === "compaction_start" || event.type === "compaction_end") {
        compactionReasons.push(`${event.type}:${event.reason}`);
      }
    });
    const compaction = await activeSession.compact(
      "Preserve the marker PERSIST_CONTEXT_MARKER and the latest numbered entries.",
    );
    compactionUnsubscribe();
    assert.ok(compaction.summary.length > 0);
    assert.ok(compactionReasons.includes("compaction_start:manual"));
    assert.ok(compactionReasons.includes("compaction_end:manual"));
    const sessionFile = sessionManager.getSessionFile();
    assert.ok(sessionFile);

    activeUnsubscribe();
    activeUnsubscribe = undefined;
    activeSession.dispose();
    activeSession = undefined;

    const reopenedManager = SessionManager.open(sessionFile);
    const restoredContext = reopenedManager.buildSessionContext();
    assert.ok(restoredContext.messages.some((message) => message.role === "compactionSummary"));
    const resumeSettings = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const reopened = await createAgentSession({
      cwd: repositoryRoot,
      agentDir: agentDirectory,
      model,
      modelRuntime,
      thinkingLevel: "off",
      tools: [],
      resourceLoader: await createResourceLoader(resumeSettings),
      sessionManager: reopenedManager,
      settingsManager: resumeSettings,
    });
    activeSession = reopened.session;
    if (reopened.modelFallbackMessage) throw new Error(reopened.modelFallbackMessage);
    activeUnsubscribe = activeSession.subscribe(() => {});
    await activeSession.prompt("Reply exactly RESUME_OK. Do not call tools.");
    const finalText = textFromAssistant(lastAssistant(activeSession.messages));
    assert.ok(finalText.includes("RESUME_OK"));
    assert.equal(reopenedManager.getSessionFile(), sessionFile);
    console.log(JSON.stringify({
      kind: "real_queue_compaction_persistence",
      steeringBeforeFollowUp: markerDeliveries[0]?.startsWith("STEER_MARKER") === true,
      queueDrained: activeSession.pendingMessageCount === 0,
      compactionSummaryCreated: compaction.summary.length > 0,
      contextHasCompactionSummary: restoredContext.messages.some((message) => message.role === "compactionSummary"),
      resumeMarkerSeen: finalText.includes("RESUME_OK"),
      sessionFilePreserved: reopenedManager.getSessionFile() === sessionFile,
    }));
  } finally {
    activeUnsubscribe?.();
    activeSession?.dispose();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const { modelRuntime, model } = await selectRealModel();
console.log(JSON.stringify({
  kind: "real_model",
  provider: model.provider,
  model: model.id,
  api: model.api,
}));
await runCancellationScenario(modelRuntime, model);
await runQueueCompactionPersistenceScenario(modelRuntime, model);
console.log(JSON.stringify({ kind: "real_controls_result", passed: true }));
