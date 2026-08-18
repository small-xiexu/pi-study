import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExtensionAPI,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

import {
  SHELL_STATE_CUSTOM_TYPE,
  createShellStateStore,
  registerShellStateLifecycle,
} from "../shell-state.ts";

type EventHandler = (event: any, ctx: any) => Promise<unknown> | unknown;

type ShellDecision = {
  entry: "tool_call" | "user_bash";
  rule: "safe" | "marker" | "other" | "unclassified" | "error";
  decision: "allow" | "deny";
  reason:
    | "safe"
    | "confirmed"
    | "policy_denied"
    | "no_local_tui"
    | "not_confirmed"
    | "signal_aborted"
    | "policy_error"
    | "ui_error";
};

type ShellStateSnapshot = {
  version: 1;
  mode: "enforce";
  blockedCount: number;
  lastDecision: ShellDecision | null;
};

const DEFAULT_SNAPSHOT: ShellStateSnapshot = {
  version: 1,
  mode: "enforce",
  blockedCount: 0,
  lastDecision: null,
};

const DENY_DECISION: ShellDecision = {
  entry: "tool_call",
  rule: "other",
  decision: "deny",
  reason: "policy_denied",
};

const ALLOW_DECISION: ShellDecision = {
  entry: "user_bash",
  rule: "safe",
  decision: "allow",
  reason: "safe",
};

function customEntry(
  customType: string,
  data: unknown,
  id = "state-1",
  parentId: string | null = null,
): SessionEntry {
  return {
    type: "custom",
    id,
    parentId,
    timestamp: "2026-08-17T00:00:00.000Z",
    customType,
    data,
  } as SessionEntry;
}

function stateEntry(
  data: unknown,
  id = "state-1",
  parentId: string | null = null,
): SessionEntry {
  return customEntry(SHELL_STATE_CUSTOM_TYPE, data, id, parentId);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createStoreHarness(options: {
  append?: (customType: string, data: unknown) => void;
} = {}) {
  const appended: Array<{ customType: string; data: unknown }> = [];
  const store = createShellStateStore(
    (customType: string, data?: unknown) => {
      appended.push({ customType, data: clone(data) });
      options.append?.(customType, data);
    },
  );

  return { appended, store };
}

test("the shell state exports one stable and bounded custom entry type", () => {
  assert.equal(SHELL_STATE_CUSTOM_TYPE, "pi-study-guard.shell-gate-state");
});

test("a new store is fail-closed until an empty branch is restored", () => {
  const { appended, store } = createStoreHarness();

  assert.equal(store.getStatus(), "uninitialized");
  assert.deepEqual(store.getSnapshot(), DEFAULT_SNAPSHOT);
  assert.equal(store.commitDecision(ALLOW_DECISION), false);
  assert.equal(appended.length, 0);

  assert.equal(store.restoreBranch(() => []), true);
  assert.equal(store.getStatus(), "ready");
  assert.deepEqual(store.getSnapshot(), DEFAULT_SNAPSHOT);
  assert.equal(appended.length, 0);
});

test("restore replays owned v1 snapshots from root to leaf", () => {
  const { appended, store } = createStoreHarness();
  const first: ShellStateSnapshot = {
    version: 1,
    mode: "enforce",
    blockedCount: 2,
    lastDecision: DENY_DECISION,
  };
  const second: ShellStateSnapshot = {
    version: 1,
    mode: "enforce",
    blockedCount: 2,
    lastDecision: ALLOW_DECISION,
  };
  let reads = 0;

  assert.equal(
    store.restoreBranch(() => {
      reads += 1;
      return [
        stateEntry(first, "state-1"),
        stateEntry(second, "state-2", "state-1"),
      ];
    }),
    true,
  );

  assert.equal(reads, 1);
  assert.equal(store.getStatus(), "ready");
  assert.deepEqual(store.getSnapshot(), second);
  assert.equal(appended.length, 0);
});

test("restore ignores unrelated custom entry types even when their data is malformed", () => {
  const { appended, store } = createStoreHarness();
  const expected: ShellStateSnapshot = {
    version: 1,
    mode: "enforce",
    blockedCount: 1,
    lastDecision: DENY_DECISION,
  };

  assert.equal(
    store.restoreBranch(() => [
      customEntry("another-extension", { version: 99, rawCommand: "redacted" }),
      stateEntry(expected, "state-2", "state-1"),
    ]),
    true,
  );

  assert.equal(store.getStatus(), "ready");
  assert.deepEqual(store.getSnapshot(), expected);
  assert.equal(appended.length, 0);
});

test("an owned unknown version rejects the whole branch without silently skipping it", () => {
  const { appended, store } = createStoreHarness();
  const valid: ShellStateSnapshot = {
    version: 1,
    mode: "enforce",
    blockedCount: 1,
    lastDecision: DENY_DECISION,
  };

  assert.equal(
    store.restoreBranch(() => [
      stateEntry(valid, "state-1"),
      stateEntry(
        { ...valid, version: 2 },
        "state-2",
        "state-1",
      ),
    ]),
    false,
  );

  assert.equal(store.getStatus(), "unsupported_version");
  assert.deepEqual(store.getSnapshot(), DEFAULT_SNAPSHOT);
  assert.equal(appended.length, 0);
});

test("an owned malformed snapshot rejects the whole branch with an invalid status", async (t) => {
  const valid: ShellStateSnapshot = {
    version: 1,
    mode: "enforce",
    blockedCount: 1,
    lastDecision: DENY_DECISION,
  };
  const invalidSnapshots: Array<{ name: string; data: unknown }> = [
    { name: "null data", data: null },
    { name: "array data", data: [] },
    {
      name: "missing field",
      data: { version: 1, mode: "enforce", blockedCount: 0 },
    },
    {
      name: "extra snapshot field",
      data: { ...valid, rawCommand: "must-not-be-persisted" },
    },
    { name: "wrong mode", data: { ...valid, mode: "observe" } },
    { name: "negative count", data: { ...valid, blockedCount: -1 } },
    { name: "fractional count", data: { ...valid, blockedCount: 1.5 } },
    {
      name: "unsafe integer count",
      data: { ...valid, blockedCount: Number.MAX_SAFE_INTEGER + 1 },
    },
    {
      name: "missing decision field",
      data: {
        ...valid,
        lastDecision: {
          entry: "tool_call",
          rule: "other",
          decision: "deny",
        },
      },
    },
    {
      name: "extra decision field",
      data: {
        ...valid,
        lastDecision: { ...DENY_DECISION, command: "must-not-be-persisted" },
      },
    },
    {
      name: "unknown entry",
      data: {
        ...valid,
        lastDecision: { ...DENY_DECISION, entry: "extension" },
      },
    },
    {
      name: "unknown rule",
      data: {
        ...valid,
        lastDecision: { ...DENY_DECISION, rule: "wildcard" },
      },
    },
    {
      name: "unknown decision",
      data: {
        ...valid,
        lastDecision: { ...DENY_DECISION, decision: "ask" },
      },
    },
    {
      name: "unknown reason",
      data: {
        ...valid,
        lastDecision: { ...DENY_DECISION, reason: "raw-error-text" },
      },
    },
  ];

  for (const invalid of invalidSnapshots) {
    await t.test(invalid.name, () => {
      const { appended, store } = createStoreHarness();

      assert.equal(
        store.restoreBranch(() => [
          stateEntry(valid, "state-1"),
          stateEntry(invalid.data, "state-2", "state-1"),
        ]),
        false,
      );
      assert.equal(store.getStatus(), "invalid");
      assert.deepEqual(store.getSnapshot(), DEFAULT_SNAPSHOT);
      assert.equal(appended.length, 0);
    });
  }
});

test("a branch reader failure is invalid and never publishes stale state", () => {
  const { appended, store } = createStoreHarness();

  assert.equal(
    store.restoreBranch(() => {
      throw new Error("redacted read failure");
    }),
    false,
  );
  assert.equal(store.getStatus(), "invalid");
  assert.deepEqual(store.getSnapshot(), DEFAULT_SNAPSHOT);
  assert.equal(appended.length, 0);
});

test("hostile owned snapshot objects cannot escape the restore boundary", async (t) => {
  const hostileValues: Array<{ name: string; data: unknown }> = [
    {
      name: "throwing proxy",
      data: new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("SECRET_PROXY_FAILURE");
          },
        },
      ),
    },
    {
      name: "throwing getter",
      data: Object.defineProperty(
        {
          mode: "enforce",
          blockedCount: 0,
          lastDecision: null,
        },
        "version",
        {
          enumerable: true,
          get() {
            throw new Error("SECRET_GETTER_FAILURE");
          },
        },
      ),
    },
  ];

  for (const hostile of hostileValues) {
    await t.test(hostile.name, () => {
      const { appended, store } = createStoreHarness();
      let restored: boolean | undefined;

      assert.doesNotThrow(() => {
        restored = store.restoreBranch(() => [stateEntry(hostile.data)]);
      });
      assert.equal(restored, false);
      assert.equal(store.getStatus(), "invalid");
      assert.deepEqual(store.getSnapshot(), DEFAULT_SNAPSHOT);
      assert.equal(appended.length, 0);
    });
  }
});

test("commit appends before publishing and increments only denied decisions", () => {
  let observedDuringAppend: ShellStateSnapshot | undefined;
  let store!: ReturnType<typeof createShellStateStore>;
  const appended: Array<{ customType: string; data: unknown }> = [];

  store = createShellStateStore(
    (customType: string, data?: unknown) => {
      observedDuringAppend = store.getSnapshot();
      appended.push({ customType, data: clone(data) });
    },
  );
  assert.equal(store.restoreBranch(() => []), true);

  assert.equal(store.commitDecision(DENY_DECISION), true);
  assert.deepEqual(observedDuringAppend, DEFAULT_SNAPSHOT);
  assert.deepEqual(store.getSnapshot(), {
    version: 1,
    mode: "enforce",
    blockedCount: 1,
    lastDecision: DENY_DECISION,
  });
  assert.deepEqual(appended, [
    {
      customType: SHELL_STATE_CUSTOM_TYPE,
      data: {
        version: 1,
        mode: "enforce",
        blockedCount: 1,
        lastDecision: DENY_DECISION,
      },
    },
  ]);

  assert.equal(store.commitDecision(ALLOW_DECISION), true);
  assert.deepEqual(observedDuringAppend, {
    version: 1,
    mode: "enforce",
    blockedCount: 1,
    lastDecision: DENY_DECISION,
  });
  assert.deepEqual(store.getSnapshot(), {
    version: 1,
    mode: "enforce",
    blockedCount: 1,
    lastDecision: ALLOW_DECISION,
  });
  assert.equal(appended.length, 2);
});

test("a denied decision cannot overflow the persisted blocked count", () => {
  const { appended, store } = createStoreHarness();
  const maximum: ShellStateSnapshot = {
    version: 1,
    mode: "enforce",
    blockedCount: Number.MAX_SAFE_INTEGER,
    lastDecision: DENY_DECISION,
  };

  assert.equal(store.restoreBranch(() => [stateEntry(maximum)]), true);
  assert.equal(store.commitDecision(DENY_DECISION), false);
  assert.equal(store.getStatus(), "invalid");
  assert.deepEqual(store.getSnapshot(), maximum);
  assert.equal(appended.length, 0);
  assert.equal(store.commitDecision(ALLOW_DECISION), false);
});

test("snapshots and decisions are defensively copied at every public boundary", () => {
  const { appended, store } = createStoreHarness();
  const mutableDecision: ShellDecision = clone(DENY_DECISION);

  assert.equal(store.restoreBranch(() => []), true);
  assert.equal(store.commitDecision(mutableDecision), true);

  mutableDecision.reason = "ui_error";
  const exposed = store.getSnapshot();
  assert.ok(exposed.lastDecision);
  exposed.blockedCount = 99;
  exposed.lastDecision.reason = "signal_aborted";

  assert.deepEqual(store.getSnapshot(), {
    version: 1,
    mode: "enforce",
    blockedCount: 1,
    lastDecision: DENY_DECISION,
  });
  assert.deepEqual(appended[0], {
    customType: SHELL_STATE_CUSTOM_TYPE,
    data: {
      version: 1,
      mode: "enforce",
      blockedCount: 1,
      lastDecision: DENY_DECISION,
    },
  });
  assert.notEqual(store.getSnapshot(), store.getSnapshot());
  assert.notEqual(
    store.getSnapshot().lastDecision,
    store.getSnapshot().lastDecision,
  );
});

test("an append exception keeps the prior snapshot and latches the store closed", () => {
  let appendAttempts = 0;
  const prior: ShellStateSnapshot = {
    version: 1,
    mode: "enforce",
    blockedCount: 1,
    lastDecision: DENY_DECISION,
  };
  const store = createShellStateStore(
    () => {
      appendAttempts += 1;
      throw new Error("redacted append failure");
    },
  );

  assert.equal(store.restoreBranch(() => [stateEntry(prior)]), true);
  assert.equal(store.commitDecision(DENY_DECISION), false);
  assert.equal(store.getStatus(), "append_failed");
  assert.deepEqual(store.getSnapshot(), prior);
  assert.equal(appendAttempts, 1);

  assert.equal(store.commitDecision(ALLOW_DECISION), false);
  assert.equal(store.restoreBranch(() => [stateEntry(prior)]), true);
  assert.equal(store.getStatus(), "ready");
  assert.deepEqual(store.getSnapshot(), prior);
  assert.equal(appendAttempts, 1);
});

function createLifecycleHarness(initialBranch: readonly SessionEntry[]) {
  const handlers = new Map<string, EventHandler[]>();
  let branch = initialBranch;
  let appendCount = 0;
  let branchReadCount = 0;
  let getEntriesCount = 0;
  const store = createShellStateStore(
    () => {
      appendCount += 1;
    },
  );
  const api = {
    on(eventName: string, handler: EventHandler) {
      const registered = handlers.get(eventName) ?? [];
      registered.push(handler);
      handlers.set(eventName, registered);
    },
  } as unknown as Pick<ExtensionAPI, "on">;

  registerShellStateLifecycle(api, store);

  return {
    handlers,
    store,
    context: {
      sessionManager: {
        getBranch() {
          branchReadCount += 1;
          return branch;
        },
        getEntries() {
          getEntriesCount += 1;
          throw new Error("lifecycle must restore only the current branch");
        },
      },
    },
    get appendCount() {
      return appendCount;
    },
    get branchReadCount() {
      return branchReadCount;
    },
    get getEntriesCount() {
      return getEntriesCount;
    },
    setBranch(nextBranch: readonly SessionEntry[]) {
      branch = nextBranch;
    },
  };
}

test("lifecycle registration owns exactly start, tree, and shutdown handlers", () => {
  const harness = createLifecycleHarness([]);

  assert.deepEqual([...harness.handlers.keys()], [
    "session_start",
    "session_tree",
    "session_shutdown",
  ]);
  assert.equal(harness.handlers.get("session_start")?.length, 1);
  assert.equal(harness.handlers.get("session_tree")?.length, 1);
  assert.equal(harness.handlers.get("session_shutdown")?.length, 1);
  assert.equal(harness.appendCount, 0);
});

test("all five session_start reasons restore from getBranch without appending", async (t) => {
  const reasons = ["startup", "reload", "new", "resume", "fork"] as const;

  for (const reason of reasons) {
    await t.test(reason, async () => {
      const expected: ShellStateSnapshot = {
        version: 1,
        mode: "enforce",
        blockedCount: reason === "new" ? 0 : 1,
        lastDecision: reason === "new" ? null : DENY_DECISION,
      };
      const branch = reason === "new" ? [] : [stateEntry(expected)];
      const harness = createLifecycleHarness(branch);
      const handler = harness.handlers.get("session_start")![0]!;

      await handler({ type: "session_start", reason }, harness.context);

      assert.equal(harness.store.getStatus(), "ready");
      assert.deepEqual(harness.store.getSnapshot(), expected);
      assert.equal(harness.branchReadCount, 1);
      assert.equal(harness.getEntriesCount, 0);
      assert.equal(harness.appendCount, 0);
    });
  }
});

test("session_tree clears stale memory before replaying the new active branch", async () => {
  const previous: ShellStateSnapshot = {
    version: 1,
    mode: "enforce",
    blockedCount: 3,
    lastDecision: ALLOW_DECISION,
  };
  const harness = createLifecycleHarness([stateEntry(previous)]);
  const start = harness.handlers.get("session_start")![0]!;
  const tree = harness.handlers.get("session_tree")![0]!;

  await start(
    { type: "session_start", reason: "startup" },
    harness.context,
  );
  assert.deepEqual(harness.store.getSnapshot(), previous);

  harness.setBranch([]);

  await tree(
    {
      type: "session_tree",
      oldLeafId: "redacted-old-leaf",
      newLeafId: "redacted-new-leaf",
    },
    harness.context,
  );

  assert.equal(harness.store.getStatus(), "ready");
  assert.deepEqual(harness.store.getSnapshot(), DEFAULT_SNAPSHOT);
  assert.equal(harness.branchReadCount, 2);
  assert.equal(harness.getEntriesCount, 0);
  assert.equal(harness.appendCount, 0);
});

test("session_shutdown only closes the store and never appends a final snapshot", async () => {
  const harness = createLifecycleHarness([]);
  const start = harness.handlers.get("session_start")![0]!;
  const shutdown = harness.handlers.get("session_shutdown")![0]!;

  await start(
    { type: "session_start", reason: "startup" },
    harness.context,
  );
  await shutdown(
    { type: "session_shutdown", reason: "quit" },
    harness.context,
  );

  assert.equal(harness.store.getStatus(), "shutdown");
  assert.deepEqual(harness.store.getSnapshot(), DEFAULT_SNAPSHOT);
  assert.equal(harness.store.commitDecision(DENY_DECISION), false);
  assert.equal(harness.store.restoreBranch(() => []), false);
  assert.equal(harness.branchReadCount, 1);
  assert.equal(harness.appendCount, 0);
});
