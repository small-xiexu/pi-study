import { Text } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type {
  ShellStateSnapshot,
  ShellStateStatus,
} from "./shell-state.ts";

export const SHELL_WIDGET_KEY = "pi-study-guard.shell-state";

type WidgetContext = Pick<ExtensionContext, "mode" | "hasUI"> & {
  ui: Pick<ExtensionContext["ui"], "setWidget">;
};

export interface ShellWidgetController {
  bind(ctx: WidgetContext): void;
  render(snapshot: ShellStateSnapshot, status: ShellStateStatus): void;
  clear(): void;
}

function decisionText(snapshot: ShellStateSnapshot): string {
  const decision = snapshot.lastDecision;
  if (!decision) return "none";
  return `${decision.entry}/${decision.rule}/${decision.decision}/${decision.reason}`;
}

function statusColor(
  snapshot: ShellStateSnapshot,
  status: ShellStateStatus,
): "success" | "error" | "warning" | "muted" {
  if (status !== "ready") return "warning";
  if (!snapshot.lastDecision) return "muted";
  return snapshot.lastDecision.decision === "allow" ? "success" : "error";
}

export function createShellWidgetController(): ShellWidgetController {
  let context: WidgetContext | undefined;
  let mounted = false;

  return {
    bind(ctx) {
      context = ctx;
    },

    render(snapshot, status) {
      if (!context || context.mode !== "tui" || !context.hasUI) return;

      try {
        mounted = true;
        const color = statusColor(snapshot, status);
        const title = status === "ready" ? "Shell Gate | enforce" : "Shell Gate | unavailable";
        const detail =
          status === "ready"
            ? `blocked=${snapshot.blockedCount} | last=${decisionText(snapshot)}`
            : `status=${status}`;
        context.ui.setWidget(
          SHELL_WIDGET_KEY,
          (_tui, theme) =>
            new Text(
              `${theme.fg("accent", title)}\n${theme.fg(color, detail)}`,
              0,
              0,
            ),
          { placement: "aboveEditor" },
        );
      } catch {
        // Widget rendering is presentation-only and cannot affect the gate.
      }
    },

    clear() {
      if (!context || !mounted) return;
      try {
        context.ui.setWidget(SHELL_WIDGET_KEY, undefined);
      } catch {
        // Cleanup remains best effort; the owning runtime is already ending.
      }
      mounted = false;
    },
  };
}
