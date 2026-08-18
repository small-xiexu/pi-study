import assert from "node:assert/strict";
import test from "node:test";

import {
  SessionManager,
  type CustomEntry,
} from "@earendil-works/pi-coding-agent";

import {
  SHELL_STATE_CUSTOM_TYPE,
  createShellStateStore,
  type ShellStateDecision,
} from "../shell-state.ts";

const COURSE_ROOT = "/redacted/pi-study";

const COMMON_DENIAL: ShellStateDecision = {
  entry: "tool_call",
  rule: "other",
  decision: "deny",
  reason: "policy_denied",
};

const BRANCH_A_DENIAL: ShellStateDecision = {
  entry: "user_bash",
  rule: "marker",
  decision: "deny",
  reason: "not_confirmed",
};

const BRANCH_B_ALLOW: ShellStateDecision = {
  entry: "tool_call",
  rule: "safe",
  decision: "allow",
  reason: "safe",
};

const DEFAULT_SNAPSHOT = {
  version: 1 as const,
  mode: "enforce" as const,
  blockedCount: 0,
  lastDecision: null,
};

function createStore(sessionManager: SessionManager) {
  return createShellStateStore((customType: string, data: unknown): void => {
    sessionManager.appendCustomEntry(customType, data);
  });
}

function restoreCurrentBranch(
  store: ReturnType<typeof createShellStateStore>,
  sessionManager: SessionManager,
): void {
  assert.equal(
    store.restoreBranch(() => sessionManager.getBranch()),
    true,
  );
  assert.equal(store.getStatus(), "ready");
}

function requireLeafId(sessionManager: SessionManager): string {
  const leafId = sessionManager.getLeafId();
  assert.ok(leafId);
  return leafId;
}

function customStateEntries(sessionManager: SessionManager) {
  return sessionManager.getEntries().filter(
    (entry): entry is CustomEntry =>
      entry.type === "custom" &&
      entry.customType === SHELL_STATE_CUSTOM_TYPE,
  );
}

test("shell state restores only the active Session branch across store recreation", () => {
  const sessionManager = SessionManager.inMemory(COURSE_ROOT);
  const store = createStore(sessionManager);

  restoreCurrentBranch(store, sessionManager);
  assert.deepEqual(store.getSnapshot(), DEFAULT_SNAPSHOT);

  assert.equal(store.commitDecision(COMMON_DENIAL), true);
  const commonLeafId = requireLeafId(sessionManager);
  assert.deepEqual(store.getSnapshot(), {
    ...DEFAULT_SNAPSHOT,
    blockedCount: 1,
    lastDecision: COMMON_DENIAL,
  });

  assert.equal(store.commitDecision(BRANCH_A_DENIAL), true);
  const branchALeafId = requireLeafId(sessionManager);
  const branchASnapshot = {
    ...DEFAULT_SNAPSHOT,
    blockedCount: 2,
    lastDecision: BRANCH_A_DENIAL,
  };
  assert.deepEqual(store.getSnapshot(), branchASnapshot);

  sessionManager.branch(commonLeafId);
  restoreCurrentBranch(store, sessionManager);
  assert.equal(store.commitDecision(BRANCH_B_ALLOW), true);
  const branchBLeafId = requireLeafId(sessionManager);
  const branchBSnapshot = {
    ...DEFAULT_SNAPSHOT,
    blockedCount: 1,
    lastDecision: BRANCH_B_ALLOW,
  };
  assert.deepEqual(store.getSnapshot(), branchBSnapshot);

  const allStateEntries = customStateEntries(sessionManager);
  assert.equal(allStateEntries.length, 3);
  assert.deepEqual(
    allStateEntries.map((entry) => entry.data),
    [
      {
        ...DEFAULT_SNAPSHOT,
        blockedCount: 1,
        lastDecision: COMMON_DENIAL,
      },
      branchASnapshot,
      branchBSnapshot,
    ],
  );

  sessionManager.branch(branchALeafId);
  assert.deepEqual(
    customStateEntries(sessionManager).at(-1)?.data,
    branchBSnapshot,
    "getEntries() still ends on branch B after the active leaf moves to branch A",
  );
  assert.deepEqual(
    sessionManager.getBranch().filter(
      (entry): entry is CustomEntry =>
        entry.type === "custom" &&
        entry.customType === SHELL_STATE_CUSTOM_TYPE,
    ).map((entry) => entry.data),
    [allStateEntries[0]!.data, branchASnapshot],
  );

  const replacementStore = createStore(sessionManager);
  restoreCurrentBranch(replacementStore, sessionManager);
  assert.deepEqual(replacementStore.getSnapshot(), branchASnapshot);

  sessionManager.branch(branchBLeafId);
  restoreCurrentBranch(replacementStore, sessionManager);
  assert.deepEqual(replacementStore.getSnapshot(), branchBSnapshot);

  sessionManager.branch(branchALeafId);
  restoreCurrentBranch(replacementStore, sessionManager);
  assert.deepEqual(replacementStore.getSnapshot(), branchASnapshot);
});

test("an in-memory Session starts from defaults and keeps Custom Entries out of Model context", () => {
  const sessionManager = SessionManager.inMemory(COURSE_ROOT);
  const store = createStore(sessionManager);

  assert.equal(sessionManager.getSessionFile(), undefined);
  restoreCurrentBranch(store, sessionManager);
  assert.deepEqual(store.getSnapshot(), DEFAULT_SNAPSHOT);

  assert.equal(store.commitDecision(COMMON_DENIAL), true);
  assert.equal(customStateEntries(sessionManager).length, 1);
  assert.deepEqual(sessionManager.buildSessionContext().messages, []);

  store.shutdown();
  assert.equal(store.getStatus(), "shutdown");
});
