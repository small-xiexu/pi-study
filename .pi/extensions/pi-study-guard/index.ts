import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerCancelProbe, registerCancelProbeFlag } from "./cancel-probe.ts";
import { registerStudyInspectCommand } from "./inspect-command.ts";
import { registerPiStudyInspect } from "./inspect-tool.ts";
import { LIFECYCLE_TRACE_UNAVAILABLE, registerLifecycleTrace } from "./lifecycle-trace.ts";
import { registerShellGate } from "./shell-gate.ts";
import { createShellStateStore, registerShellStateLifecycle } from "./shell-state.ts";

export const GUARD_FLAG = "pi-study-guard";

function failClosedTraceRecorder(): never {
  throw new Error(LIFECYCLE_TRACE_UNAVAILABLE);
}

export default function registerPiStudyGuard(pi: ExtensionAPI): void {
  pi.registerFlag(GUARD_FLAG, {
    description: "Mark the minimal pi-study-guard extension as loaded",
    type: "boolean",
    default: false,
  });

  registerCancelProbeFlag(pi);
  let traceRecorders: ReturnType<typeof registerLifecycleTrace>;
  let traceInitializationFailed = false;
  try {
    traceRecorders = registerLifecycleTrace(pi);
  } catch {
    traceInitializationFailed = true;
  }
  const missingTraceRecorder = traceInitializationFailed ? failClosedTraceRecorder : () => {};
  const shellState = createShellStateStore((customType, data) => {
    pi.appendEntry(customType, data);
  });
  registerShellStateLifecycle(pi, shellState);
  registerCancelProbe(pi, {
    record: traceRecorders?.cancelProbe ?? missingTraceRecorder,
    stderr: (message) => process.stderr.write(message),
  });
  registerShellGate(pi, {
    state: shellState,
    record: traceRecorders?.shellGate ?? missingTraceRecorder,
  });
  registerPiStudyInspect(pi);
  registerStudyInspectCommand(pi);
}
