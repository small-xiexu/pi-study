import type {
  ExtensionAPI,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import {
  SHELL_STATE_CUSTOM_TYPE,
  createShellStateStore,
  type ShellStateSnapshot,
} from "../../shell-state.ts";

export const STATE_PROBE_COMMAND_NAME = "pi-study-state-probe";
export const STATE_PROBE_UNAVAILABLE = "PI_STUDY_STATE_PROBE_UNAVAILABLE";

export interface StateProbeProjection {
  sessionFile: "none" | "present";
  ownedEntries: number;
  blockedCount: number;
  lastDecision: string;
}

type ProbeSessionManager = Pick<SessionManager, "getBranch" | "getSessionFile">;

function formatLastDecision(snapshot: ShellStateSnapshot): string {
  const last = snapshot.lastDecision;
  if (last === null) return "none";
  return `${last.entry}/${last.rule}/${last.decision}/${last.reason}`;
}

export function projectShellState(
  sessionManager: ProbeSessionManager,
): StateProbeProjection | undefined {
  try {
    const branch = [...sessionManager.getBranch()];
    let ownedEntries = 0;
    for (const entry of branch) {
      if (
        entry.type === "custom" &&
        entry.customType === SHELL_STATE_CUSTOM_TYPE
      ) {
        ownedEntries += 1;
      }
    }

    const store = createShellStateStore(() => {
      throw new Error(STATE_PROBE_UNAVAILABLE);
    });
    if (!store.restoreBranch(() => branch) || store.getStatus() !== "ready") {
      return undefined;
    }

    const snapshot = store.getSnapshot();
    return {
      sessionFile:
        sessionManager.getSessionFile() === undefined ? "none" : "present",
      ownedEntries,
      blockedCount: snapshot.blockedCount,
      lastDecision: formatLastDecision(snapshot),
    };
  } catch {
    return undefined;
  }
}

export function formatStateProbe(projection: StateProbeProjection): string {
  return [
    "PI_STUDY_STATE_PROBE",
    `sessionFile=${projection.sessionFile}`,
    `ownedEntries=${projection.ownedEntries}`,
    `blockedCount=${projection.blockedCount}`,
    `lastDecision=${projection.lastDecision}`,
  ].join(" ");
}

export function registerStateProbe(
  pi: Pick<ExtensionAPI, "registerCommand">,
): void {
  pi.registerCommand(STATE_PROBE_COMMAND_NAME, {
    description: "Show a bounded read-only Shell state projection for the current Branch",
    handler: async (_args, ctx) => {
      const projection = projectShellState(ctx.sessionManager);
      ctx.ui.notify(
        projection === undefined
          ? STATE_PROBE_UNAVAILABLE
          : formatStateProbe(projection),
        projection === undefined ? "error" : "info",
      );
    },
  });
}

export default registerStateProbe;
