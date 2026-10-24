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

/**
 * The shell gate remains enforced by shell-gate.ts. This controller intentionally
 * keeps its status widget hidden to avoid adding a persistent banner above the
 * editor.
 */
export function createShellWidgetController(): ShellWidgetController {
  return {
    bind(_ctx) {
      // The gate state is still restored and published; only its visual widget is hidden.
    },

    render(_snapshot, _status) {
      // Intentionally do not call setWidget(). Enforcement is presentation-independent.
    },

    clear() {
      // No widget is mounted, so there is nothing to clean up.
    },
  };
}
