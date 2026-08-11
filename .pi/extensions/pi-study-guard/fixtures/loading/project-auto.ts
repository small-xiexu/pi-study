import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function registerProjectAutoProbe(pi: ExtensionAPI): void {
  pi.registerFlag("pi-study-source-project-auto", {
    description: "[5.1] Loaded by project auto-discovery",
    type: "boolean",
  });
}
