import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function registerCliProbe(pi: ExtensionAPI): void {
  pi.registerFlag("pi-study-source-cli", {
    description: "[5.1] Loaded from the CLI extension path",
    type: "boolean",
  });
}
