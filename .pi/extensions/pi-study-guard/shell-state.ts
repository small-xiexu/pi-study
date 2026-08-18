import type {
  ExtensionAPI,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

export const SHELL_STATE_CUSTOM_TYPE = "pi-study-guard.shell-gate-state";

export type ShellStateEntry = "tool_call" | "user_bash";
export type ShellStateRule =
  | "safe"
  | "marker"
  | "other"
  | "unclassified"
  | "error";
export type ShellStateReason =
  | "safe"
  | "confirmed"
  | "policy_denied"
  | "no_local_tui"
  | "not_confirmed"
  | "signal_aborted"
  | "policy_error"
  | "ui_error";

export interface ShellStateDecision {
  entry: ShellStateEntry;
  rule: ShellStateRule;
  decision: "allow" | "deny";
  reason: ShellStateReason;
}

export interface ShellStateSnapshot {
  version: 1;
  mode: "enforce";
  blockedCount: number;
  lastDecision: ShellStateDecision | null;
}

export type ShellStateStatus =
  | "uninitialized"
  | "ready"
  | "invalid"
  | "unsupported_version"
  | "append_failed"
  | "shutdown";

export interface ShellStateStore {
  getStatus(): ShellStateStatus;
  getSnapshot(): ShellStateSnapshot;
  restoreBranch(readBranch: () => readonly SessionEntry[]): boolean;
  commitDecision(decision: ShellStateDecision): boolean;
  shutdown(): void;
}

type AppendEntry = (customType: string, data: unknown) => void;

const DEFAULT_SNAPSHOT: ShellStateSnapshot = {
  version: 1,
  mode: "enforce",
  blockedCount: 0,
  lastDecision: null,
};

const ENTRIES = new Set<ShellStateEntry>(["tool_call", "user_bash"]);
const RULES = new Set<ShellStateRule>([
  "safe",
  "marker",
  "other",
  "unclassified",
  "error",
]);
const DECISIONS = new Set<ShellStateDecision["decision"]>(["allow", "deny"]);
const REASONS = new Set<ShellStateReason>([
  "safe",
  "confirmed",
  "policy_denied",
  "no_local_tui",
  "not_confirmed",
  "signal_aborted",
  "policy_error",
  "ui_error",
]);

function cloneSnapshot(snapshot: ShellStateSnapshot): ShellStateSnapshot {
  return structuredClone(snapshot);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === "string" && expected.includes(key))
  );
}

function isDecision(value: unknown): value is ShellStateDecision {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ["entry", "rule", "decision", "reason"])) return false;

  return (
    typeof value.entry === "string" &&
    ENTRIES.has(value.entry as ShellStateEntry) &&
    typeof value.rule === "string" &&
    RULES.has(value.rule as ShellStateRule) &&
    typeof value.decision === "string" &&
    DECISIONS.has(value.decision as ShellStateDecision["decision"]) &&
    typeof value.reason === "string" &&
    REASONS.has(value.reason as ShellStateReason)
  );
}

type SnapshotParseResult =
  | { status: "valid"; snapshot: ShellStateSnapshot }
  | { status: "invalid" | "unsupported_version" };

function parseSnapshot(value: unknown): SnapshotParseResult {
  if (!isPlainObject(value)) return { status: "invalid" };
  if (value.version !== 1) {
    return Object.hasOwn(value, "version")
      ? { status: "unsupported_version" }
      : { status: "invalid" };
  }
  if (!hasExactKeys(value, ["version", "mode", "blockedCount", "lastDecision"])) {
    return { status: "invalid" };
  }
  if (
    value.mode !== "enforce" ||
    !Number.isSafeInteger(value.blockedCount) ||
    (value.blockedCount as number) < 0 ||
    (value.lastDecision !== null && !isDecision(value.lastDecision))
  ) {
    return { status: "invalid" };
  }

  return {
    status: "valid",
    snapshot: cloneSnapshot(value as unknown as ShellStateSnapshot),
  };
}

export function createShellStateStore(appendEntry: AppendEntry): ShellStateStore {
  let status: ShellStateStatus = "uninitialized";
  let snapshot = cloneSnapshot(DEFAULT_SNAPSHOT);

  return {
    getStatus() {
      return status;
    },

    getSnapshot() {
      return cloneSnapshot(snapshot);
    },

    restoreBranch(readBranch) {
      if (status === "shutdown") return false;

      status = "uninitialized";
      snapshot = cloneSnapshot(DEFAULT_SNAPSHOT);

      try {
        const branch = readBranch();
        let restored = cloneSnapshot(DEFAULT_SNAPSHOT);
        for (const entry of branch) {
          if (entry.type !== "custom" || entry.customType !== SHELL_STATE_CUSTOM_TYPE) continue;

          const parsed = parseSnapshot(entry.data);
          if (parsed.status !== "valid") {
            status = parsed.status;
            snapshot = cloneSnapshot(DEFAULT_SNAPSHOT);
            return false;
          }
          restored = parsed.snapshot;
        }

        snapshot = cloneSnapshot(restored);
        status = "ready";
        return true;
      } catch {
        status = "invalid";
        snapshot = cloneSnapshot(DEFAULT_SNAPSHOT);
        return false;
      }
    },

    commitDecision(decision) {
      if (status !== "ready" || !isDecision(decision)) return false;

      const blockedCount =
        decision.decision === "deny" ? snapshot.blockedCount + 1 : snapshot.blockedCount;
      if (!Number.isSafeInteger(blockedCount)) {
        status = "invalid";
        return false;
      }

      const candidate: ShellStateSnapshot = {
        version: 1,
        mode: "enforce",
        blockedCount,
        lastDecision: structuredClone(decision),
      };

      try {
        appendEntry(SHELL_STATE_CUSTOM_TYPE, cloneSnapshot(candidate));
      } catch {
        status = "append_failed";
        return false;
      }

      snapshot = cloneSnapshot(candidate);
      return true;
    },

    shutdown() {
      status = "shutdown";
      snapshot = cloneSnapshot(DEFAULT_SNAPSHOT);
    },
  };
}

export function registerShellStateLifecycle(
  pi: Pick<ExtensionAPI, "on">,
  store: ShellStateStore,
): void {
  const restore = (ctx: { sessionManager: { getBranch(): readonly SessionEntry[] } }): void => {
    store.restoreBranch(() => ctx.sessionManager.getBranch());
  };

  pi.on("session_start", (_event, ctx) => {
    restore(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restore(ctx);
  });

  pi.on("session_shutdown", () => {
    store.shutdown();
  });
}
