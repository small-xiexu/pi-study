import assert from "node:assert/strict";
import {
  appendFile,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CURRENT_SESSION_VERSION,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import type { ConsoleRecord } from "../safe-output.ts";
import {
  acquireSessionDirectoryLease,
  classifyTaskCompletion,
  createTaskResourceLoader,
  ensurePrivateSessionDirectory,
  hasPersistedAssistantMessage,
  resolveSessionDirectory,
  SESSION_LEASE_FILE,
  SdkTaskConsoleRuntime,
  validateSessionFiles,
  type TaskSdkSessionManagerPort,
  type TaskSdkSessionPort,
} from "../task-console-runtime.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeSdkSession implements TaskSdkSessionPort {
  abortCount = 0;
  disposeCount = 0;
  unsubscribeCount = 0;
  readonly promptCalls: string[] = [];
  promptScript: (text: string) => Promise<void> = async () => {};
  abortScript: () => Promise<void> = async () => {};
  disposeScript: () => void = () => {};
  unsubscribeScript: () => void = () => {};
  private listener?: (event: unknown) => void;

  subscribe(listener: (event: unknown) => void): () => void {
    this.listener = listener;
    return () => {
      this.unsubscribeCount += 1;
      this.unsubscribeScript();
      this.listener = undefined;
    };
  }

  async prompt(text: string, options: { expandPromptTemplates: false }): Promise<void> {
    assert.equal(options.expandPromptTemplates, false);
    this.promptCalls.push(text);
    await this.promptScript(text);
  }

  emit(event: unknown): void {
    this.listener?.(event);
  }

  async abort(): Promise<void> {
    this.abortCount += 1;
    await this.abortScript();
  }

  dispose(): void {
    this.disposeCount += 1;
    this.disposeScript();
  }

  getActiveToolNames(): string[] {
    return ["read"];
  }
}

function injectedRuntime(
  session: FakeSdkSession,
  entries: Array<Record<string, unknown>> = [],
): {
  runtime: SdkTaskConsoleRuntime;
  sessionManager: TaskSdkSessionManagerPort;
} {
  const sessionManager: TaskSdkSessionManagerPort = {
    getEntries: () => entries,
  };
  return {
    runtime: new SdkTaskConsoleRuntime({
      repositoryRoot: "/course/repository",
      sessionDirectory: "/private/course-sessions",
      createSdkContext: async () => ({
        session,
        sessionManager,
        readyInfo: {
          session: entries.length > 0 ? "RESUMED" : "NEW",
          model: "openai/gpt-5.6-sol",
          tools: ["read"],
        },
      }),
    }),
    sessionManager,
  };
}

test("resolves an override without exposing the repository", () => {
  assert.equal(
    resolveSessionDirectory({
      env: { PI_STUDY_77_SESSION_DIR: "/private/session-root" },
      homeDirectory: "/home/learner",
    }),
    "/private/session-root",
  );
  assert.equal(
    resolveSessionDirectory({ env: {}, homeDirectory: "/home/learner" }),
    "/home/learner/.pi/agent/sessions/pi-study-7.7-sdk-task-console",
  );
});

test("creates the dedicated session directory with private POSIX permissions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.7-session-"));
  const sessionDirectory = path.join(root, "sessions");
  try {
    await ensurePrivateSessionDirectory(sessionDirectory);
    const mode = (await stat(sessionDirectory)).mode & 0o777;
    if (process.platform !== "win32") assert.equal(mode, 0o700);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a session directory inside the repository", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.7-path-"));
  const repositoryRoot = path.join(root, "project");
  try {
    await mkdir(repositoryRoot, { recursive: true });
    await assert.rejects(
      ensurePrivateSessionDirectory(path.join(repositoryRoot, ".sessions"), { repositoryRoot }),
      /outside.*repository/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not chmod or adopt an unrelated existing directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.7-unowned-"));
  const sharedDirectory = path.join(root, "shared");
  try {
    await mkdir(sharedDirectory);
    await writeFile(path.join(sharedDirectory, "user-file.txt"), "keep\n");
    if (process.platform !== "win32") await chmod(sharedDirectory, 0o755);

    await assert.rejects(
      ensurePrivateSessionDirectory(sharedDirectory),
      /dedicated|owned|session directory/i,
    );
    if (process.platform !== "win32") {
      assert.equal((await stat(sharedDirectory)).mode & 0o777, 0o755);
    }
    assert.equal((await stat(path.join(sharedDirectory, "user-file.txt"))).isFile(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "rejects Session JSONL symlinks that escape the private directory",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.7-symlink-"));
    const repositoryRoot = path.join(root, "project");
    const sessionDirectory = path.join(root, "private-sessions");
    const repositoryTarget = path.join(repositoryRoot, "must-not-write.jsonl");
    try {
      await mkdir(repositoryRoot);
      await writeFile(repositoryTarget, "UNCHANGED\n");
      await ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot });
      await symlink(repositoryTarget, path.join(sessionDirectory, "escape.jsonl"));

      await assert.rejects(
        ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot }),
        /symbolic|symlink|session file/i,
      );
      assert.equal(await readFile(repositoryTarget, "utf8"), "UNCHANGED\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "rejects Session JSONL hard links that alias an external file",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.7-hardlink-"));
    const repositoryRoot = path.join(root, "project");
    const sessionDirectory = path.join(root, "private-sessions");
    const repositoryTarget = path.join(repositoryRoot, "must-not-write.jsonl");
    try {
      await mkdir(repositoryRoot);
      await writeFile(repositoryTarget, "UNCHANGED\n");
      await ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot });
      await link(repositoryTarget, path.join(sessionDirectory, "escape.jsonl"));

      await assert.rejects(
        ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot }),
        /hard link|session file/i,
      );
      assert.equal(await readFile(repositoryTarget, "utf8"), "UNCHANGED\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("rejects a corrupt Session JSONL without changing its bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-corrupt-session-"));
  const repositoryRoot = path.join(root, "project");
  const sessionDirectory = path.join(root, "private-sessions");
  try {
    await mkdir(repositoryRoot);
    await ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot });
    const manager = SessionManager.create(repositoryRoot, sessionDirectory);
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "synthetic validation entry" }],
      api: "openai-responses",
      provider: "pi-study-test",
      model: "session-validator",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    await validateSessionFiles(sessionDirectory, { repositoryRoot });

    const sessionFile = manager.getSessionFile();
    assert.ok(sessionFile);
    await appendFile(sessionFile, "{\"type\":\n", "utf8");
    const corruptBytes = await readFile(sessionFile);

    await assert.rejects(
      validateSessionFiles(sessionDirectory, { repositoryRoot }),
      (error: unknown) => error instanceof Error && error.name === "SessionFileContractViolation",
    );
    assert.deepEqual(await readFile(sessionFile), corruptBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts the current Pi Session entry union", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-current-session-"));
  const repositoryRoot = path.join(root, "project");
  const sessionDirectory = path.join(root, "private-sessions");
  try {
    await mkdir(repositoryRoot);
    await ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot });
    const manager = SessionManager.create(repositoryRoot, sessionDirectory);
    const messageId = manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "synthetic current-version entry" }],
      api: "openai-responses",
      provider: "pi-study-test",
      model: "session-validator",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    manager.appendThinkingLevelChange("off");
    manager.appendModelChange("openai", "gpt-5.6-sol");
    manager.appendCustomEntry("pi-study-validation", { valid: true });
    manager.appendCustomMessageEntry(
      "pi-study-validation",
      [{ type: "text", text: "custom context" }],
      false,
      { valid: true },
    );
    manager.appendSessionInfo("validation session");
    manager.appendLabelChange(messageId, "validation label");
    manager.appendCompaction("summary", messageId, 10, { valid: true }, false);
    manager.resetLeaf();
    manager.branchWithSummary(null, "branch summary", { valid: true }, false);

    assert.equal(manager.getHeader()?.version, CURRENT_SESSION_VERSION);
    await validateSessionFiles(sessionDirectory, { repositoryRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unknown and malformed current-version Session entries without mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-entry-union-"));
  const repositoryRoot = path.join(root, "project");
  const sessionDirectory = path.join(root, "private-sessions");
  const sessionFile = path.join(sessionDirectory, "invalid.jsonl");
  const timestamp = new Date().toISOString();
  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: "validation-session",
    timestamp,
    cwd: repositoryRoot,
  };
  const seed = {
    type: "message",
    id: "seed0001",
    parentId: null,
    timestamp,
    message: { role: "user", content: "seed", timestamp: Date.now() },
  };
  const base = { id: "entry002", parentId: seed.id, timestamp };
  const invalidEntries: Array<Record<string, unknown>> = [
    { ...base, type: "future_entry" },
    {
      ...base,
      type: "message",
      message: { role: "assistant", content: [], timestamp: Date.now() },
    },
    { ...base, type: "thinking_level_change", thinkingLevel: 7 },
    { ...base, type: "model_change", provider: 7, modelId: "gpt-5.6-sol" },
    {
      ...base,
      type: "compaction",
      summary: "summary",
      firstKeptEntryId: seed.id,
      tokensBefore: "10",
    },
    { ...base, type: "branch_summary", fromId: seed.id, summary: 7 },
    { ...base, type: "custom", customType: 7 },
    {
      ...base,
      type: "custom_message",
      customType: "validation",
      content: [{ type: "unknown" }],
      display: false,
    },
    { ...base, type: "label", targetId: seed.id, label: 7 },
    { ...base, type: "session_info", name: 7 },
  ];

  try {
    await mkdir(repositoryRoot);
    await ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot });
    for (const invalidEntry of invalidEntries) {
      const bytes = Buffer.from(
        `${JSON.stringify(header)}\n${JSON.stringify(seed)}\n${JSON.stringify(invalidEntry)}\n`,
        "utf8",
      );
      await writeFile(sessionFile, bytes, { mode: 0o600 });

      await assert.rejects(
        validateSessionFiles(sessionDirectory, { repositoryRoot }),
        (error: unknown) => error instanceof Error && error.name === "SessionFileContractViolation",
      );
      assert.deepEqual(await readFile(sessionFile), bytes);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a legacy Session version without migrating or rewriting it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-legacy-session-"));
  const repositoryRoot = path.join(root, "project");
  const sessionDirectory = path.join(root, "private-sessions");
  const sessionFile = path.join(sessionDirectory, "legacy.jsonl");
  try {
    await mkdir(repositoryRoot);
    await ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot });
    const bytes = Buffer.from(
      `${JSON.stringify({
        type: "session",
        version: 1,
        id: "legacy-session",
        timestamp: new Date().toISOString(),
        cwd: repositoryRoot,
      })}\n`,
      "utf8",
    );
    await writeFile(sessionFile, bytes, { mode: 0o600 });

    await assert.rejects(
      validateSessionFiles(sessionDirectory, { repositoryRoot }),
      (error: unknown) => error instanceof Error && error.name === "SessionFileContractViolation",
    );
    assert.deepEqual(await readFile(sessionFile), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "rejects an unreadable Session JSONL without changing it",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-unreadable-session-"));
    const repositoryRoot = path.join(root, "project");
    const sessionDirectory = path.join(root, "private-sessions");
    let sessionFile: string | undefined;
    try {
      await mkdir(repositoryRoot);
      await ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot });
      const manager = SessionManager.create(repositoryRoot, sessionDirectory);
      manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "synthetic unreadable entry" }],
        api: "openai-responses",
        provider: "pi-study-test",
        model: "session-validator",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      });
      sessionFile = manager.getSessionFile();
      assert.ok(sessionFile);
      const originalBytes = await readFile(sessionFile);
      await chmod(sessionFile, 0o000);

      await assert.rejects(
        validateSessionFiles(sessionDirectory, { repositoryRoot }),
        (error: unknown) => error instanceof Error && error.name === "SessionFileContractViolation",
      );

      await chmod(sessionFile, 0o600);
      assert.deepEqual(await readFile(sessionFile), originalBytes);
    } finally {
      if (sessionFile) await chmod(sessionFile, 0o600).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "rejects a readable Session JSONL that cannot be appended",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-readonly-session-"));
    const repositoryRoot = path.join(root, "project");
    const sessionDirectory = path.join(root, "private-sessions");
    let sessionFile: string | undefined;
    try {
      await mkdir(repositoryRoot);
      await ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot });
      const manager = SessionManager.create(repositoryRoot, sessionDirectory);
      manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "synthetic read-only entry" }],
        api: "openai-responses",
        provider: "pi-study-test",
        model: "session-validator",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      });
      sessionFile = manager.getSessionFile();
      assert.ok(sessionFile);
      const originalBytes = await readFile(sessionFile);
      await chmod(sessionFile, 0o400);

      await assert.rejects(
        validateSessionFiles(sessionDirectory, { repositoryRoot }),
        (error: unknown) => error instanceof Error && error.name === "SessionFileContractViolation",
      );

      await chmod(sessionFile, 0o600);
      assert.deepEqual(await readFile(sessionFile), originalBytes);
    } finally {
      if (sessionFile) await chmod(sessionFile, 0o600).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "fails before Session use when its owned directory is not writable",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-unwritable-session-"));
    const sessionDirectory = path.join(root, "private-sessions");
    try {
      await ensurePrivateSessionDirectory(sessionDirectory);
      await chmod(sessionDirectory, 0o500);

      await assert.rejects(
        acquireSessionDirectoryLease(sessionDirectory),
        (error: unknown) =>
          error instanceof Error && error.name === "SessionDirectoryPermissionError",
      );
    } finally {
      await chmod(sessionDirectory, 0o700).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("allows one Session writer, releases exactly once, and rejects a live second writer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-session-lease-"));
  const sessionDirectory = path.join(root, "private-sessions");
  try {
    await ensurePrivateSessionDirectory(sessionDirectory);
    const first = await acquireSessionDirectoryLease(sessionDirectory, {
      processId: 101,
      processNonce: "first-owner",
    });
    await ensurePrivateSessionDirectory(sessionDirectory);

    await assert.rejects(
      acquireSessionDirectoryLease(sessionDirectory, {
        processId: 202,
        processNonce: "second-owner",
      }),
      (error: unknown) => error instanceof Error && error.name === "SessionDirectoryBusy",
    );

    await first.release();
    await first.release();
    await assert.rejects(stat(path.join(sessionDirectory, SESSION_LEASE_FILE)), {
      code: "ENOENT",
    });

    const second = await acquireSessionDirectoryLease(sessionDirectory, {
      processId: 202,
      processNonce: "second-owner",
    });
    await second.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("never reclaims an existing Session lease automatically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-stale-lease-"));
  const sessionDirectory = path.join(root, "private-sessions");
  try {
    await ensurePrivateSessionDirectory(sessionDirectory);
    const stale = await acquireSessionDirectoryLease(sessionDirectory, {
      processId: 303,
      processNonce: "stale-owner",
    });
    const leasePath = path.join(sessionDirectory, SESSION_LEASE_FILE);
    const staleBytes = await readFile(leasePath);

    await assert.rejects(
      acquireSessionDirectoryLease(sessionDirectory, {
        processId: 404,
        processNonce: "new-owner",
      }),
      (error: unknown) => error instanceof Error && error.name === "SessionDirectoryBusy",
    );
    assert.deepEqual(await readFile(leasePath), staleBytes);

    await stale.release();
    const current = await acquireSessionDirectoryLease(sessionDirectory, {
      processId: 404,
      processNonce: "new-owner",
    });
    await current.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("continues the most recent course session without a Provider", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.7-resume-"));
  const cwd = path.join(root, "project");
  const sessionDirectory = path.join(root, "private-sessions");
  try {
    await mkdir(cwd, { recursive: true });
    await ensurePrivateSessionDirectory(sessionDirectory, { repositoryRoot: cwd });

    const first = SessionManager.create(cwd, sessionDirectory);
    assert.equal(first.getEntries().length, 0);
    first.appendCustomEntry("pi-study-7.7-resume-probe", { marker: true });
    first.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "resume probe" }],
      api: "openai-responses",
      provider: "pi-study-test",
      model: "resume-probe",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const firstSessionId = first.getHeader()?.id;

    const resumed = SessionManager.continueRecent(cwd, sessionDirectory);

    assert.equal(resumed.getHeader()?.id, firstSessionId);
    assert.equal(
      resumed
        .getEntries()
        .some((entry) => entry.type === "custom" && entry.customType === "pi-study-7.7-resume-probe"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marks an assistant message saved only after a matching session entry exists", () => {
  const assistantTimestamp = 1_770_000_000_000;
  assert.equal(hasPersistedAssistantMessage([], assistantTimestamp), false);
  assert.equal(
    hasPersistedAssistantMessage(
      [
        {
          type: "message",
          message: { role: "assistant", timestamp: assistantTimestamp - 1, stopReason: "stop" },
        },
      ],
      assistantTimestamp,
    ),
    false,
  );
  assert.equal(
    hasPersistedAssistantMessage(
      [
        {
          type: "message",
          message: { role: "assistant", timestamp: assistantTimestamp, stopReason: "stop" },
        },
      ],
      assistantTimestamp,
    ),
    true,
  );
});

test("loads context files while disabling every executable or prompt resource", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.7-resources-"));
  const cwd = path.join(root, "project");
  const agentDirectory = path.join(root, "agent");
  try {
    await mkdir(path.join(cwd, ".pi"), { recursive: true });
    await mkdir(agentDirectory, { recursive: true });
    await writeFile(path.join(cwd, "AGENTS.md"), "TASK_CONSOLE_CONTEXT_7701\n");
    await writeFile(path.join(cwd, ".pi", "SYSTEM.md"), "SYSTEM_MUST_NOT_LOAD\n");
    await writeFile(path.join(cwd, ".pi", "APPEND_SYSTEM.md"), "APPEND_MUST_NOT_LOAD\n");

    const loader = await createTaskResourceLoader({ cwd, agentDirectory });

    assert.equal(loader.getExtensions().extensions.length, 0);
    assert.equal(loader.getSkills().skills.length, 0);
    assert.equal(loader.getPrompts().prompts.length, 0);
    assert.equal(loader.getThemes().themes.length, 0);
    assert.equal(loader.getSystemPrompt(), undefined);
    assert.equal(loader.getSystemPromptSource(), undefined);
    assert.deepEqual(loader.getAppendSystemPrompt(), []);
    assert.deepEqual(loader.getAppendSystemPromptSources(), []);
    assert.equal(
      loader
        .getAgentsFiles()
        .agentsFiles.some((file) => file.content.includes("TASK_CONSOLE_CONTEXT_7701")),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("injects only the repository root context when global context also exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.7-extra-context-"));
  const cwd = path.join(root, "project");
  const agentDirectory = path.join(root, "agent");
  try {
    await mkdir(cwd);
    await mkdir(agentDirectory);
    await writeFile(path.join(cwd, "AGENTS.md"), "PROJECT_CONTEXT_7701\n");
    await writeFile(path.join(agentDirectory, "AGENTS.md"), "GLOBAL_CONTEXT_MUST_REJECT\n");

    const loader = await createTaskResourceLoader({ cwd, agentDirectory });
    const contextFiles = loader.getAgentsFiles().agentsFiles;

    assert.equal(contextFiles.length, 1);
    assert.equal(path.resolve(contextFiles[0]?.path ?? ""), path.join(cwd, "AGENTS.md"));
    assert.equal(contextFiles[0]?.content.includes("PROJECT_CONTEXT_7701"), true);
    assert.equal(
      contextFiles.some((file) => file.content.includes("GLOBAL_CONTEXT_MUST_REJECT")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects startup context when the repository root instruction is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-study-7.8-missing-context-"));
  const cwd = path.join(root, "project");
  const agentDirectory = path.join(root, "agent");
  try {
    await mkdir(cwd);
    await mkdir(agentDirectory);
    await writeFile(path.join(agentDirectory, "AGENTS.md"), "GLOBAL_CONTEXT_MUST_NOT_SUBSTITUTE\n");

    await assert.rejects(
      createTaskResourceLoader({ cwd, agentDirectory }),
      /repository context|resource contract/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires current-run success, settled, and persistence before completion", () => {
  const currentAssistant = {
    role: "assistant",
    content: [{ type: "text", text: "TASK_CONSOLE_OK" }],
    stopReason: "stop",
    timestamp: 1_770_000_000_001,
  };

  assert.deepEqual(
    classifyTaskCompletion({
      promptSucceeded: true,
      settled: true,
      finalAssistant: currentAssistant,
      saved: true,
      cancelRequested: false,
    }),
    { outcome: "completed", answer: "TASK_CONSOLE_OK", saved: true },
  );
  assert.equal(
    classifyTaskCompletion({
      promptSucceeded: true,
      settled: false,
      finalAssistant: currentAssistant,
      saved: true,
      cancelRequested: false,
    }).outcome,
    "failed",
  );
  assert.equal(
    classifyTaskCompletion({
      promptSucceeded: false,
      settled: true,
      finalAssistant: currentAssistant,
      saved: true,
      cancelRequested: false,
    }).outcome,
    "failed",
  );
  assert.equal(
    classifyTaskCompletion({
      promptSucceeded: true,
      settled: true,
      finalAssistant: { ...currentAssistant, stopReason: "error" },
      saved: true,
      cancelRequested: false,
    }).outcome,
    "failed",
  );
  assert.deepEqual(
    classifyTaskCompletion({
      promptSucceeded: false,
      settled: true,
      finalAssistant: { ...currentAssistant, stopReason: "aborted" },
      saved: false,
      cancelRequested: true,
    }),
    { outcome: "cancelled", saved: false },
  );
});

test("does not reuse a restored assistant when the new prompt fails preflight", async () => {
  const oldTimestamp = 1_770_000_000_010;
  const entries = [
    {
      type: "message",
      message: { role: "assistant", timestamp: oldTimestamp, stopReason: "stop" },
    },
  ];
  const session = new FakeSdkSession();
  session.promptScript = async () => {
    throw new Error("preflight failed");
  };
  const { runtime } = injectedRuntime(session, entries);
  await runtime.initialize();

  const result = await runtime.runTask("new task");

  assert.equal(result.outcome, "failed");
  assert.equal(session.promptCalls.length, 1);
  await runtime.close();
});

test("fails when prompt rejects after current message and settled events", async () => {
  const entries: Array<Record<string, unknown>> = [];
  const session = new FakeSdkSession();
  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "must not complete" }],
    stopReason: "stop",
    timestamp: 1_770_000_000_011,
  };
  session.promptScript = async () => {
    session.emit({ type: "message_end", message: assistant });
    entries.push({ type: "message", message: assistant });
    session.emit({ type: "agent_settled" });
    throw new Error("prompt rejected after settled");
  };
  const { runtime } = injectedRuntime(session, entries);
  await runtime.initialize();

  const result = await runtime.runTask("new task");

  assert.equal(result.outcome, "failed");
  await runtime.close();
});

test("re-aborts when a cancelled task starts after delayed preflight", async () => {
  const session = new FakeSdkSession();
  const preflight = deferred<void>();
  const runRelease = deferred<void>();
  const promptEntered = deferred<void>();
  let agentStarted = false;
  session.abortScript = async () => {
    if (agentStarted) runRelease.resolve();
  };
  session.promptScript = async () => {
    promptEntered.resolve();
    await preflight.promise;
    agentStarted = true;
    session.emit({ type: "agent_start" });
    await runRelease.promise;
    session.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "aborted",
        timestamp: 1_770_000_000_012,
      },
    });
    session.emit({ type: "agent_settled" });
  };
  const { runtime } = injectedRuntime(session);
  await runtime.initialize();

  const task = runtime.runTask("delayed task");
  await promptEntered.promise;
  assert.equal(await runtime.cancel(), true);
  assert.equal(session.abortCount, 1);

  preflight.resolve();
  const result = await task;

  assert.equal(result.outcome, "cancelled");
  assert.equal(session.abortCount >= 2, true);
  await runtime.close();
});

test("fails closed when cancellation throws even if an aborted message follows", async () => {
  const session = new FakeSdkSession();
  const promptEntered = deferred<void>();
  const runRelease = deferred<void>();
  session.abortScript = async () => {
    runRelease.resolve();
    throw new Error("abort failed");
  };
  session.promptScript = async () => {
    promptEntered.resolve();
    await runRelease.promise;
    session.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "aborted",
        timestamp: 1_770_000_000_014,
      },
    });
    session.emit({ type: "agent_settled" });
  };
  const { runtime } = injectedRuntime(session);
  await runtime.initialize();

  const task = runtime.runTask("cancel failure");
  await promptEntered.promise;
  assert.equal(await runtime.cancel(), true);
  const result = await task;

  assert.deepEqual(result, {
    outcome: "failed",
    stage: "RUNTIME",
    errorKind: "CancellationFailure",
  });
  await runtime.close();
});

test("keeps READING until every parallel read call has ended", async () => {
  const entries: Array<Record<string, unknown>> = [];
  const records: ConsoleRecord[] = [];
  const session = new FakeSdkSession();
  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "parallel reads complete" }],
    stopReason: "stop",
    timestamp: 1_770_000_000_013,
  };
  session.promptScript = async () => {
    session.emit({ type: "tool_execution_start", toolName: "read", toolCallId: "read-1" });
    session.emit({ type: "tool_execution_start", toolName: "read", toolCallId: "read-2" });
    session.emit({ type: "tool_execution_end", toolName: "read", toolCallId: "read-1" });
    session.emit({ type: "tool_execution_end", toolName: "read", toolCallId: "read-2" });
    session.emit({ type: "message_end", message: assistant });
    entries.push({ type: "message", message: assistant });
    session.emit({ type: "agent_settled" });
  };
  const { runtime } = injectedRuntime(session, entries);
  await runtime.initialize();
  runtime.subscribe((record) => records.push(record));

  const result = await runtime.runTask("parallel reads");

  assert.equal(result.outcome, "completed");
  assert.deepEqual(records, [
    { status: "READING", tool: "read" },
    { status: "READING", tool: "read" },
    { status: "READING", tool: "read" },
    { status: "RUNNING" },
  ]);
  await runtime.close();
});

test("releases the Session lease once and ignores SDK events without an active run", async () => {
  const session = new FakeSdkSession();
  let releaseCount = 0;
  const records: ConsoleRecord[] = [];
  const runtime = new SdkTaskConsoleRuntime({
    repositoryRoot: "/course/repository",
    sessionDirectory: "/private/course-sessions",
    createSdkContext: async () => ({
      session,
      sessionManager: { getEntries: () => [] },
      readyInfo: {
        session: "NEW",
        model: "openai/gpt-5.6-sol",
        tools: ["read"],
      },
      releaseLease: async () => {
        releaseCount += 1;
      },
    }),
  });
  await runtime.initialize();
  runtime.subscribe((record) => records.push(record));
  session.emit({ type: "tool_execution_start", toolName: "read", toolCallId: "before-close" });

  await runtime.close();
  await runtime.close();
  session.emit({ type: "tool_execution_start", toolName: "read", toolCallId: "after-close" });

  assert.equal(session.disposeCount, 1);
  assert.equal(releaseCount, 1);
  assert.deepEqual(records, []);
});

test("releases the Session lease when initialization rejects its runtime contract", async () => {
  const session = new FakeSdkSession();
  let releaseCount = 0;
  const runtime = new SdkTaskConsoleRuntime({
    repositoryRoot: "/course/repository",
    sessionDirectory: "/private/course-sessions",
    createSdkContext: async () => ({
      session,
      sessionManager: { getEntries: () => [] },
      readyInfo: {
        session: "NEW",
        model: "openai/gpt-5.6-sol",
        tools: ["read", "bash"],
      },
      releaseLease: async () => {
        releaseCount += 1;
      },
    }),
  });

  await assert.rejects(runtime.initialize());

  assert.equal(session.disposeCount, 1);
  assert.equal(releaseCount, 1);
});

test("preserves an initialization failure and reports a failed lease cleanup on close", async () => {
  const session = new FakeSdkSession();
  let releaseCount = 0;
  const runtime = new SdkTaskConsoleRuntime({
    repositoryRoot: "/course/repository",
    sessionDirectory: "/private/course-sessions",
    createSdkContext: async () => ({
      session,
      sessionManager: { getEntries: () => [] },
      readyInfo: {
        session: "NEW",
        model: "openai/gpt-5.6-sol",
        tools: ["read", "bash"],
      },
      releaseLease: async () => {
        releaseCount += 1;
        throw new Error("private lease cleanup detail");
      },
    }),
  });

  await assert.rejects(
    runtime.initialize(),
    (error: unknown) => error instanceof Error && error.name === "ToolContractViolation",
  );
  await assert.rejects(
    runtime.close(),
    (error: unknown) => error instanceof Error && error.name === "ShutdownFailure",
  );
  assert.equal(session.disposeCount, 1);
  assert.equal(releaseCount, 1);
});

test("attempts unsubscribe, dispose, and lease release before returning ShutdownFailure", async () => {
  const session = new FakeSdkSession();
  session.unsubscribeScript = () => {
    throw new Error("private unsubscribe detail");
  };
  session.disposeScript = () => {
    throw new Error("private dispose detail");
  };
  let releaseCount = 0;
  const runtime = new SdkTaskConsoleRuntime({
    repositoryRoot: "/course/repository",
    sessionDirectory: "/private/course-sessions",
    createSdkContext: async () => ({
      session,
      sessionManager: { getEntries: () => [] },
      readyInfo: {
        session: "NEW",
        model: "openai/gpt-5.6-sol",
        tools: ["read"],
      },
      releaseLease: async () => {
        releaseCount += 1;
        throw new Error("private release detail");
      },
    }),
  });
  await runtime.initialize();

  await assert.rejects(
    runtime.close(),
    (error: unknown) => error instanceof Error && error.name === "ShutdownFailure",
  );

  assert.equal(session.unsubscribeCount, 1);
  assert.equal(session.disposeCount, 1);
  assert.equal(releaseCount, 1);
});
