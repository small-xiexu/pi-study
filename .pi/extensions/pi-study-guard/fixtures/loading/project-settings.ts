import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function registerProjectSettingsProbe(pi: ExtensionAPI): void {
  pi.registerFlag("pi-study-source-project-settings", {
    description: "[5.1] Loaded from the project settings path",
    type: "boolean",
  });
}
