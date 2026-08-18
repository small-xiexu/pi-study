export const SHELL_SAFE_COMMAND = "printf '%s\\n' PI_STUDY_SHELL_SAFE";

export const SHELL_MARKER_COMMAND =
  "printf '%s\\n' PI_STUDY_SHELL_EXECUTED > PI_STUDY_SHELL_GATE_MARKER.txt";

export type ShellPolicyDecision = "allow" | "approval_required" | "deny";

export function classifyShellCommand(command: string): ShellPolicyDecision {
  if (command === SHELL_SAFE_COMMAND) return "allow";
  if (command === SHELL_MARKER_COMMAND) return "approval_required";
  return "deny";
}
