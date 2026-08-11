import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function registerGlobalAutoProbe(pi: ExtensionAPI): void {
  pi.registerFlag("pi-study-source-global-auto", {
    description: "[5.1] Loaded by global auto-discovery",
    type: "boolean",
  });
}
