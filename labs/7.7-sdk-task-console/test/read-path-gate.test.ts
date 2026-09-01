import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
import type { ConsoleRecord } from "../safe-output.ts";
import * as runtimeModule from "../task-console-runtime.ts";

const ALLOWED_RELATIVE_PATH = path.join(
  "labs",
  "7.7-sdk-task-console",
  "fixture.txt",
);
const BLOCK_REASON = "Read request blocked by task path policy";

interface GateContext {
  readonly toolCall: { readonly name: string };
  readonly args: unknown;
}

interface GateResult {
  readonly block?: boolean;
  readonly reason?: string;
  readonly terminate?: boolean;
}

type GateHook = (
  context: GateContext,
  signal?: AbortSignal,
) => Promise<GateResult | undefined>;

interface GateAgent {
  beforeToolCall?: GateHook;
}

interface GateSession {
  readonly agent: GateAgent;
}

type InstallTaskReadPathGate = (agent: GateAgent, repositoryRoot: string) => void;
type InstallTaskReadPathGateForSession = (
  session: GateSession,
  repositoryRoot: string,
) => void;

function installTaskReadPathGate(agent: GateAgent, repositoryRoot: string): void {
  const candidate: unknown = (runtimeModule as unknown as Record<string, unknown>)[
    "installTaskReadPathGate"
  ];
  assert.equal(
    typeof candidate,
    "function",
    "installTaskReadPathGate must be exported",
  );
  (candidate as InstallTaskReadPathGate)(agent, repositoryRoot);
}

function installTaskReadPathGateForSession(
  session: GateSession,
  repositoryRoot: string,
): void {
  const candidate: unknown = (runtimeModule as unknown as Record<string, unknown>)[
    "installTaskReadPathGateForSession"
  ];
  assert.equal(
    typeof candidate,
    "function",
    "installTaskReadPathGateForSession must be exported",
  );
  (candidate as InstallTaskReadPathGateForSession)(session, repositoryRoot);
}

function blocked(): GateResult {
  return { block: true, reason: BLOCK_REASON };
}

async function createRepositoryFixture(): Promise<{
  root: string;
  repositoryRoot: string;
  fixturePath: string;
}> {
  const root = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "pi-study-7.7-read-gate-"),
  );
  const repositoryRoot = path.join(root, "repository");
  const fixturePath = path.join(repositoryRoot, ALLOWED_RELATIVE_PATH);
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(path.join(repositoryRoot, "AGENTS.md"), "TASK_READ_GATE_CONTEXT\n");
  await writeFile(fixturePath, "TASK_READ_GATE_ALLOWED\n");
  return { root, repositoryRoot, fixturePath };
}

async function invokeRead(
  agent: GateAgent,
  args: unknown,
  signal?: AbortSignal,
): Promise<GateResult | undefined> {
  assert.ok(agent.beforeToolCall);
  return agent.beforeToolCall(
    {
      toolCall: { name: "read" },
      args,
    },
    signal,
  );
}

test("allows only the canonical relative and absolute fixture paths", async () => {
  const fixture = await createRepositoryFixture();
  let existingHookCalls = 0;
  const agent: GateAgent = {
    beforeToolCall: async () => {
      existingHookCalls += 1;
      return undefined;
    },
  };

  try {
    installTaskReadPathGate(agent, fixture.repositoryRoot);

    assert.equal(
      await invokeRead(agent, { path: ALLOWED_RELATIVE_PATH }),
      undefined,
    );
    assert.equal(
      await invokeRead(agent, { path: fixture.fixturePath }),
      undefined,
    );
    assert.equal(existingHookCalls, 2);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("preserves an existing beforeToolCall block for an allowed path", async () => {
  const fixture = await createRepositoryFixture();
  const existingBlock: GateResult = {
    block: true,
    reason: "existing policy block",
    terminate: true,
  };
  const agent: GateAgent = {
    beforeToolCall: async () => existingBlock,
  };

  try {
    installTaskReadPathGate(agent, fixture.repositoryRoot);

    assert.deepEqual(
      await invokeRead(agent, { path: ALLOWED_RELATIVE_PATH }),
      existingBlock,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("installs the path gate through the default factory session contract", async () => {
  const fixture = await createRepositoryFixture();
  let existingHookCalls = 0;
  const agent: GateAgent = {
    beforeToolCall: async () => {
      existingHookCalls += 1;
      return undefined;
    },
  };

  try {
    installTaskReadPathGateForSession({ agent }, fixture.repositoryRoot);

    assert.equal(
      await invokeRead(agent, { path: ALLOWED_RELATIVE_PATH }),
      undefined,
    );
    assert.deepEqual(
      await invokeRead(agent, { path: path.join(fixture.repositoryRoot, "AGENTS.md") }),
      blocked(),
    );
    assert.equal(existingHookCalls, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rechecks an allowed path after an existing hook mutates its arguments", async () => {
  const fixture = await createRepositoryFixture();
  const outsidePath = path.join(fixture.root, "mutated-outside.txt");
  const args = { path: ALLOWED_RELATIVE_PATH };
  let existingHookCalls = 0;
  const agent: GateAgent = {
    beforeToolCall: async (context) => {
      existingHookCalls += 1;
      assert.equal(context.args, args);
      args.path = outsidePath;
      return undefined;
    },
  };

  try {
    await writeFile(outsidePath, "MUTATED_OUTSIDE_MUST_NOT_READ\n");
    installTaskReadPathGate(agent, fixture.repositoryRoot);

    assert.deepEqual(await invokeRead(agent, args), blocked());
    assert.equal(existingHookCalls, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("blocks repository escapes, other files, and aliases with one fixed reason", async () => {
  const fixture = await createRepositoryFixture();
  const outsidePath = path.join(fixture.root, "outside.txt");
  const otherLabFile = path.join(
    fixture.repositoryRoot,
    "labs",
    "7.7-sdk-task-console",
    "other.txt",
  );
  await writeFile(outsidePath, "OUTSIDE_MUST_NOT_READ\n");
  await writeFile(otherLabFile, "OTHER_MUST_NOT_READ\n");

  let existingHookCalls = 0;
  const agent: GateAgent = {
    beforeToolCall: async () => {
      existingHookCalls += 1;
      return undefined;
    },
  };

  try {
    installTaskReadPathGate(agent, fixture.repositoryRoot);
    const separator = path.sep;
    const rejectedPaths = [
      outsidePath,
      path.join(fixture.repositoryRoot, "AGENTS.md"),
      otherLabFile,
      "fixture.txt",
      `.${separator}${ALLOWED_RELATIVE_PATH}`,
      [
        "labs",
        "7.7-sdk-task-console",
        "..",
        "7.7-sdk-task-console",
        "fixture.txt",
      ].join(separator),
      `${path.dirname(fixture.fixturePath)}${separator}..${separator}7.7-sdk-task-console${separator}fixture.txt`,
      ALLOWED_RELATIVE_PATH.replace(separator, `${separator}${separator}`),
    ];

    for (const rejectedPath of rejectedPaths) {
      assert.deepEqual(await invokeRead(agent, { path: rejectedPath }), blocked());
    }
    assert.equal(existingHookCalls, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("blocks missing paths, directories, non-string paths, and cancelled calls", async (t) => {
  await t.test("missing target", async () => {
    const fixture = await createRepositoryFixture();
    try {
      await rm(fixture.fixturePath);
      const agent: GateAgent = {};
      installTaskReadPathGate(agent, fixture.repositoryRoot);
      assert.deepEqual(
        await invokeRead(agent, { path: ALLOWED_RELATIVE_PATH }),
        blocked(),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("directory target", async () => {
    const fixture = await createRepositoryFixture();
    try {
      await rm(fixture.fixturePath);
      await mkdir(fixture.fixturePath);
      const agent: GateAgent = {};
      installTaskReadPathGate(agent, fixture.repositoryRoot);
      assert.deepEqual(
        await invokeRead(agent, { path: fixture.fixturePath }),
        blocked(),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("non-string path", async () => {
    const fixture = await createRepositoryFixture();
    try {
      const agent: GateAgent = {};
      installTaskReadPathGate(agent, fixture.repositoryRoot);
      for (const invalidPath of [undefined, null, 7, {}, []]) {
        assert.deepEqual(await invokeRead(agent, { path: invalidPath }), blocked());
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("already cancelled signal", async () => {
    const fixture = await createRepositoryFixture();
    let existingHookCalls = 0;
    const agent: GateAgent = {
      beforeToolCall: async () => {
        existingHookCalls += 1;
        return undefined;
      },
    };
    const abortController = new AbortController();
    abortController.abort();
    try {
      installTaskReadPathGate(agent, fixture.repositoryRoot);
      assert.deepEqual(
        await invokeRead(
          agent,
          { path: ALLOWED_RELATIVE_PATH },
          abortController.signal,
        ),
        blocked(),
      );
      assert.equal(existingHookCalls, 0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

test(
  "blocks a symbolic-link fixture",
  { skip: process.platform === "win32" },
  async () => {
    const fixture = await createRepositoryFixture();
    const linkTarget = path.join(fixture.root, "symlink-target.txt");
    try {
      await writeFile(linkTarget, "SYMLINK_MUST_NOT_READ\n");
      await rm(fixture.fixturePath);
      await symlink(linkTarget, fixture.fixturePath);
      const agent: GateAgent = {};
      installTaskReadPathGate(agent, fixture.repositoryRoot);

      assert.deepEqual(
        await invokeRead(agent, { path: ALLOWED_RELATIVE_PATH }),
        blocked(),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  },
);

test(
  "blocks a canonical relative path that escapes through a symbolic-link parent",
  { skip: process.platform === "win32" },
  async () => {
    const fixture = await createRepositoryFixture();
    const outsideLabs = path.join(fixture.root, "outside-labs");
    const escapedFixture = path.join(
      outsideLabs,
      "7.7-sdk-task-console",
      "fixture.txt",
    );
    try {
      await mkdir(path.dirname(escapedFixture), { recursive: true });
      await writeFile(escapedFixture, "PARENT_SYMLINK_MUST_NOT_READ\n");
      await rm(path.join(fixture.repositoryRoot, "labs"), {
        recursive: true,
        force: true,
      });
      await symlink(outsideLabs, path.join(fixture.repositoryRoot, "labs"));
      const agent: GateAgent = {};
      installTaskReadPathGate(agent, fixture.repositoryRoot);

      assert.deepEqual(
        await invokeRead(agent, { path: ALLOWED_RELATIVE_PATH }),
        blocked(),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  },
);

test(
  "blocks a symbolic-link repository root and a repository root with a symbolic-link ancestor",
  { skip: process.platform === "win32" },
  async (t) => {
    const fixture = await createRepositoryFixture();
    try {
      await t.test("repository root is a symbolic link", async () => {
        const linkedRepositoryRoot = path.join(fixture.root, "repository-link");
        await symlink(fixture.repositoryRoot, linkedRepositoryRoot);
        const agent: GateAgent = {};
        installTaskReadPathGate(agent, linkedRepositoryRoot);

        assert.deepEqual(
          await invokeRead(agent, { path: ALLOWED_RELATIVE_PATH }),
          blocked(),
        );
      });

      await t.test("repository root has a symbolic-link ancestor", async () => {
        const linkedParent = path.join(fixture.root, "parent-link");
        await symlink(fixture.root, linkedParent);
        const agent: GateAgent = {};
        installTaskReadPathGate(agent, path.join(linkedParent, "repository"));

        assert.deepEqual(
          await invokeRead(agent, { path: ALLOWED_RELATIVE_PATH }),
          blocked(),
        );
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  },
);

test(
  "blocks a hard-linked fixture",
  { skip: process.platform === "win32" },
  async () => {
    const fixture = await createRepositoryFixture();
    const linkTarget = path.join(fixture.root, "hard-link-target.txt");
    try {
      await writeFile(linkTarget, "HARD_LINK_MUST_NOT_READ\n");
      await rm(fixture.fixturePath);
      await link(linkTarget, fixture.fixturePath);
      const agent: GateAgent = {};
      installTaskReadPathGate(agent, fixture.repositoryRoot);

      assert.deepEqual(
        await invokeRead(agent, { path: fixture.fixturePath }),
        blocked(),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  },
);

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

function blockedReadStream(model: Model<Api>): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const toolCall: ToolCall = {
    type: "toolCall",
    id: "task-read-gate-blocked",
    name: "read",
    arguments: { path: "AGENTS.md" },
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

function finalTextStream(model: Model<Api>): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const pending = assistantMessage(model, [{ type: "text", text: "" }], "pending");
  const complete = assistantMessage(
    model,
    [{ type: "text", text: "BLOCKED_AS_EXPECTED" }],
    "stop",
  );
  stream.push({ type: "start", partial: pending });
  stream.push({ type: "text_start", contentIndex: 0, partial: pending });
  stream.push({
    type: "text_delta",
    contentIndex: 0,
    delta: "BLOCKED_AS_EXPECTED",
    partial: complete,
  });
  stream.push({
    type: "text_end",
    contentIndex: 0,
    content: "BLOCKED_AS_EXPECTED",
    partial: complete,
  });
  stream.push({ type: "done", reason: "stop", message: complete });
  stream.end(complete);
  return stream;
}

test("blocks before the real SDK read executor and emits a fixed error Tool Result", async () => {
  const fixture = await createRepositoryFixture();
  const agentDirectory = path.join(fixture.root, "agent");
  const sessionManager = SessionManager.inMemory(fixture.repositoryRoot);
  let requestCount = 0;
  let executeCount = 0;
  let abortCount = 0;

  try {
    await mkdir(agentDirectory);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, provider: { maxRetries: 0 } },
    });
    const resourceLoader = await runtimeModule.createTaskResourceLoader({
      cwd: fixture.repositoryRoot,
      agentDirectory,
      settingsManager,
    });
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
    });
    modelRuntime.registerProvider("openai", {
      name: "Pi Study Read Gate Test",
      api: "openai-responses",
      baseUrl: "http://127.0.0.1",
      apiKey: "pi-study-local-only",
      streamSimple: (model) => {
        requestCount += 1;
        return requestCount === 1
          ? blockedReadStream(model)
          : finalTextStream(model);
      },
      models: [
        {
          id: "gpt-5.6-sol",
          name: "Read Gate Test Model",
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

    const created = await createAgentSession({
      cwd: fixture.repositoryRoot,
      agentDir: agentDirectory,
      model,
      thinkingLevel: "off",
      modelRuntime,
      resourceLoader,
      tools: ["read"],
      sessionManager,
      settingsManager,
    });
    try {
      const readTool = created.session.agent.state.tools.find(
        (tool) => tool.name === "read",
      );
      assert.ok(readTool);
      const originalExecute = readTool.execute;
      created.session.agent.state.tools = [
        {
          ...readTool,
          execute: async (...args: Parameters<typeof originalExecute>) => {
            executeCount += 1;
            return originalExecute(...args);
          },
        },
      ];
      installTaskReadPathGate(
        created.session.agent as unknown as GateAgent,
        fixture.repositoryRoot,
      );
      const records: ConsoleRecord[] = [];
      const answers: string[] = [];
      const runtime = new runtimeModule.SdkTaskConsoleRuntime({
        repositoryRoot: fixture.repositoryRoot,
        sessionDirectory: path.join(fixture.root, "unused-sessions"),
        createSdkContext: async () => ({
          session: {
            subscribe: (listener) =>
              created.session.subscribe((event) => listener(event)),
            prompt: (text, options) => created.session.prompt(text, options),
            abort: async () => {
              abortCount += 1;
              await created.session.abort();
            },
            dispose: () => created.session.dispose(),
            getActiveToolNames: () => created.session.getActiveToolNames(),
          },
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
      assert.equal(await controller.handleLine("attempt one blocked read"), "STARTED");
      await controller.waitForIdle();
      await controller.handleLine("/quit");

      assert.equal(requestCount, 1);
      assert.equal(executeCount, 0);
      assert.equal(abortCount, 1);
      assert.deepEqual(answers, []);
      assert.equal(
        records.some(
          (record) =>
            record.status === "FAILED" &&
            record.stage === "RUNTIME" &&
            record.errorKind === "ToolContractViolation",
        ),
        true,
      );
      assert.equal(records.some((record) => record.status === "COMPLETED"), false);
      const toolResults = sessionManager
        .getEntries()
        .flatMap((entry) =>
          entry.type === "message" && entry.message.role === "toolResult"
            ? [entry.message]
            : [],
        );
      assert.equal(toolResults.length, 1);
      const result = toolResults[0];
      assert.ok(result && result.role === "toolResult");
      assert.equal(result.isError, true);
      assert.deepEqual(result.content, [{ type: "text", text: BLOCK_REASON }]);
    } finally {
      created.session.dispose();
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
