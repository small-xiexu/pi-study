import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerLifecycleTrace } from "./lifecycle-trace.ts";

export const GUARD_FLAG = "pi-study-guard";

export default function registerPiStudyGuard(pi: ExtensionAPI): void {
  pi.registerFlag(GUARD_FLAG, {
    description: "Mark the minimal pi-study-guard extension as loaded",
    type: "boolean",
    default: false,
  });

  registerLifecycleTrace(pi);
}
