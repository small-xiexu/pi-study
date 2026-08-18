import assert from "node:assert/strict";
import test from "node:test";

import {
  SessionManager,
  type ExtensionAPI,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

import {
  STATE_PROBE_COMMAND_NAME,
  STATE_PROBE_UNAVAILABLE,
  formatStateProbe,
  projectShellState,
  registerStateProbe,
} from "../fixtures/state-probe/index.ts";
import {
  SHELL_STATE_CUSTOM_TYPE,
  createShellStateStore,
  type ShellStateDecision,
  type ShellStateSnapshot,
} from "../shell-state.ts";

type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];

const DENY: ShellStateDecision = {
  entry: "user_bash",
  rule: "other",
  decision: "deny",
  reason: "policy_denied",
};

const ALLOW: ShellStateDecision = {
  entry: "user_bash",
  rule: "safe",
  decision: "allow",
  reason: "safe",
};

function snapshot(
  blockedCount: number,
  lastDecision: ShellStateDecision | null,
): ShellStateSnapshot {
  return {
    version: 1,
    mode: "enforce",
    blockedCount,
    lastDecision,
  };
}

function ownedEntry(data: unknown): SessionEntry {
  return {
    type: "custom",
    customType: SHELL_STATE_CUSTOM_TYPE,
    data,
  } as SessionEntry;
}

function registerCommand(): CommandOptions {
  const registrations: Array<{ name: string; options: CommandOptions }> = [];
  registerStateProbe({
    registerCommand(name, options) {
      registrations.push({ name, options });
    },
  } as Pick<ExtensionAPI, "registerCommand">);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.name, STATE_PROBE_COMMAND_NAME);
  assert.equal(STATE_PROBE_COMMAND_NAME, "pi-study-state-probe");
  assert.match(registrations[0]?.options.description ?? "", /Shell state/u);
  return registrations[0]!.options;
}

function fakeManager(
  branch: readonly SessionEntry[],
  sessionFile?: string,
): Pick<SessionManager, "getBranch" | "getSessionFile"> {
  return {
    getBranch: () => [...branch],
    getSessionFile: () => sessionFile,
  } as Pick<SessionManager, "getBranch" | "getSessionFile">;
}

test("the explicit state probe registers one bounded Slash Command", () => {
  const command = registerCommand();
  assert.equal(command.getArgumentCompletions, undefined);
});

test("the state probe projects an empty in-memory Session without creating entries", () => {
  const sessionManager = SessionManager.inMemory("/redacted/pi-study");
  const before = structuredClone(sessionManager.getEntries());

  const projection = projectShellState(sessionManager);

  assert.deepEqual(projection, {
    sessionFile: "none",
    ownedEntries: 0,
    blockedCount: 0,
    lastDecision: "none",
  });
  assert.equal(
    formatStateProbe(projection!),
    "PI_STUDY_STATE_PROBE sessionFile=none ownedEntries=0 blockedCount=0 lastDecision=none",
  );
  assert.deepEqual(sessionManager.getEntries(), before);
});

test("the state probe reuses production replay for deny, allow, and deny snapshots", () => {
  const sessionManager = SessionManager.inMemory("/redacted/pi-study");
  const store = createShellStateStore((customType, data) => {
    sessionManager.appendCustomEntry(customType, data);
  });
  assert.equal(store.restoreBranch(() => sessionManager.getBranch()), true);
  assert.equal(store.commitDecision(DENY), true);
  assert.equal(store.commitDecision(ALLOW), true);
  assert.equal(store.commitDecision(DENY), true);
  const before = structuredClone(sessionManager.getEntries());

  const projection = projectShellState(sessionManager);

  assert.deepEqual(projection, {
    sessionFile: "none",
    ownedEntries: 3,
    blockedCount: 2,
    lastDecision: "user_bash/other/deny/policy_denied",
  });
  assert.equal(
    formatStateProbe(projection!),
    "PI_STUDY_STATE_PROBE sessionFile=none ownedEntries=3 blockedCount=2 lastDecision=user_bash/other/deny/policy_denied",
  );
  assert.deepEqual(sessionManager.getEntries(), before);
});

test("the state probe follows only the active Branch", () => {
  const sessionManager = SessionManager.inMemory("/redacted/pi-study");
  const store = createShellStateStore((customType, data) => {
    sessionManager.appendCustomEntry(customType, data);
  });
  assert.equal(store.restoreBranch(() => sessionManager.getBranch()), true);
  assert.equal(store.commitDecision(DENY), true);
  const sharedLeaf = sessionManager.getLeafId();
  assert.ok(sharedLeaf);

  assert.equal(store.commitDecision(DENY), true);
  const branchALeaf = sessionManager.getLeafId();
  assert.ok(branchALeaf);

  sessionManager.branch(sharedLeaf);
  assert.equal(store.restoreBranch(() => sessionManager.getBranch()), true);
  assert.equal(store.commitDecision(ALLOW), true);
  assert.deepEqual(projectShellState(sessionManager), {
    sessionFile: "none",
    ownedEntries: 2,
    blockedCount: 1,
    lastDecision: "user_bash/safe/allow/safe",
  });

  sessionManager.branch(branchALeaf);
  assert.deepEqual(projectShellState(sessionManager), {
    sessionFile: "none",
    ownedEntries: 2,
    blockedCount: 2,
    lastDecision: "user_bash/other/deny/policy_denied",
  });
});

test("the state probe ignores non-owned entries without reading message or foreign data", () => {
  const message = {
    type: "message",
    get message() {
      throw new Error("SECRET_MESSAGE_BODY");
    },
  } as unknown as SessionEntry;
  const foreign = {
    type: "custom",
    customType: "other.extension.state",
    get data() {
      throw new Error("SECRET_FOREIGN_DATA");
    },
  } as unknown as SessionEntry;

  assert.deepEqual(
    projectShellState(fakeManager([message, foreign, ownedEntry(snapshot(1, DENY))])),
    {
      sessionFile: "none",
      ownedEntries: 1,
      blockedCount: 1,
      lastDecision: "user_bash/other/deny/policy_denied",
    },
  );
});

test("the state probe maps any Session path to present without exposing it", () => {
  const secretPath = "/SECRET/private/session.jsonl";
  const projection = projectShellState(
    fakeManager([ownedEntry(snapshot(1, DENY))], secretPath),
  );
  const output = formatStateProbe(projection!);

  assert.match(output, /sessionFile=present/u);
  assert.doesNotMatch(output, /SECRET|private|session\.jsonl/u);
});

test("the state probe rejects malformed and unknown owned snapshots", () => {
  for (const data of [
    { ...snapshot(1, DENY), unexpected: true },
    { ...snapshot(1, DENY), version: 2 },
  ]) {
    assert.equal(projectShellState(fakeManager([ownedEntry(data)])), undefined);
  }
});

test("the state probe turns hostile SessionManager failures into one fixed message", async (t) => {
  const command = registerCommand();

  for (const [name, sessionManager] of [
    [
      "branch failure",
      {
        getBranch() {
          throw new Error("SECRET_BRANCH_FAILURE");
        },
        getSessionFile() {
          return undefined;
        },
      },
    ],
    [
      "session file failure",
      {
        getBranch() {
          return [];
        },
        getSessionFile() {
          throw new Error("SECRET_PATH_FAILURE");
        },
      },
    ],
  ] as const) {
    await t.test(name, async () => {
      const notifications: Array<{ message: string; level: string }> = [];
      await command.handler("", {
        sessionManager,
        ui: {
          notify(message: string, level: string) {
            notifications.push({ message, level });
          },
        },
      } as any);

      assert.deepEqual(notifications, [
        { message: STATE_PROBE_UNAVAILABLE, level: "error" },
      ]);
      assert.equal(STATE_PROBE_UNAVAILABLE, "PI_STUDY_STATE_PROBE_UNAVAILABLE");
      assert.doesNotMatch(notifications[0]!.message, /SECRET/u);
    });
  }
});

test("the state probe uses the fresh Command Context after reload", async () => {
  const command = registerCommand();
  const notifications: string[] = [];
  const notify = (message: string): void => {
    notifications.push(message);
  };

  await command.handler("", {
    sessionManager: fakeManager([]),
    ui: { notify },
  } as any);
  await command.handler("", {
    sessionManager: fakeManager([
      ownedEntry(snapshot(1, DENY)),
      ownedEntry(snapshot(2, DENY)),
    ]),
    ui: { notify },
  } as any);

  assert.deepEqual(notifications, [
    "PI_STUDY_STATE_PROBE sessionFile=none ownedEntries=0 blockedCount=0 lastDecision=none",
    "PI_STUDY_STATE_PROBE sessionFile=none ownedEntries=2 blockedCount=2 lastDecision=user_bash/other/deny/policy_denied",
  ]);
});
