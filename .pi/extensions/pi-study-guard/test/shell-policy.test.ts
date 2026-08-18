import assert from "node:assert/strict";
import test from "node:test";

import {
  SHELL_MARKER_COMMAND,
  SHELL_SAFE_COMMAND,
  classifyShellCommand,
} from "../shell-policy.ts";

const EXPECTED_SAFE_COMMAND = "printf '%s\\n' PI_STUDY_SHELL_SAFE";
const EXPECTED_MARKER_COMMAND =
  "printf '%s\\n' PI_STUDY_SHELL_EXECUTED > PI_STUDY_SHELL_GATE_MARKER.txt";

test("the shell policy recognizes only the two exact course commands", () => {
  assert.equal(SHELL_SAFE_COMMAND, EXPECTED_SAFE_COMMAND);
  assert.equal(SHELL_MARKER_COMMAND, EXPECTED_MARKER_COMMAND);
  assert.equal(classifyShellCommand(EXPECTED_SAFE_COMMAND), "allow");
  assert.equal(classifyShellCommand(EXPECTED_MARKER_COMMAND), "approval_required");
});

test("the shell policy denies every near match and unknown command", () => {
  const denied = [
    "",
    ` ${EXPECTED_SAFE_COMMAND}`,
    `${EXPECTED_SAFE_COMMAND} `,
    `${EXPECTED_SAFE_COMMAND}\n`,
    `${EXPECTED_SAFE_COMMAND};`,
    "printf '%s\\n' pi_study_shell_safe",
    ` ${EXPECTED_MARKER_COMMAND}`,
    `${EXPECTED_MARKER_COMMAND} `,
    `${EXPECTED_MARKER_COMMAND}\n`,
    `${EXPECTED_MARKER_COMMAND};`,
    EXPECTED_MARKER_COMMAND.replace("PI_STUDY_SHELL_GATE_MARKER.txt", "OTHER.txt"),
    "rm -rf important-data",
  ];

  for (const command of denied) {
    assert.equal(classifyShellCommand(command), "deny", command);
  }
});

test("the shell policy is deterministic and does not rewrite its input", () => {
  const command = EXPECTED_MARKER_COMMAND;

  assert.equal(classifyShellCommand(command), "approval_required");
  assert.equal(classifyShellCommand(command), "approval_required");
  assert.equal(command, EXPECTED_MARKER_COMMAND);
});
