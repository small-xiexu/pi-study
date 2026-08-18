import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  formatInspectSummary,
  inspectMarkdownFile,
  type InspectDetails,
  type InspectRequest,
} from "./inspect-service.ts";
import { validateInspectFileName } from "./inspect-path.ts";

export const INSPECT_COMMAND_NAME = "study-inspect";
export const INSPECT_COMMAND_COMPLETION_FILE = "06-extensions.md";

interface InspectCommandDependencies {
  inspect?: (request: InspectRequest) => Promise<InspectDetails>;
  formatSummary?: (details: InspectDetails) => string;
  stderr?: (message: string) => void;
}

type FeedbackLevel = "info" | "error";

function commandError(code: string): Error {
  return new Error(code);
}

function parseCommandFile(args: string): string {
  const normalized = args.trim();
  if (!normalized) {
    throw commandError("PI_STUDY_INSPECT_COMMAND_FILE_REQUIRED");
  }

  const tokens = normalized.split(/\s+/u);
  if (tokens.length !== 1 || normalized.startsWith("-")) {
    throw commandError("PI_STUDY_INSPECT_COMMAND_UNKNOWN_ARGUMENT");
  }
  return validateInspectFileName(tokens[0]!);
}

function stableErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    /^PI_STUDY_INSPECT_[A-Z0-9_]+(?: file=[A-Za-z0-9][A-Za-z0-9._-]{0,124}\.md)?$/u.test(
      error.message,
    )
  ) {
    return error.message;
  }
  return "PI_STUDY_INSPECT_COMMAND_FAILED";
}

function emitFeedback(
  ctx: ExtensionCommandContext,
  stderr: (message: string) => void,
  message: string,
  level: FeedbackLevel,
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
    return;
  }
  stderr(`${message}\n`);
}

export function registerStudyInspectCommand(
  pi: Pick<ExtensionAPI, "registerCommand">,
  dependencies: InspectCommandDependencies = {},
): void {
  const inspect = dependencies.inspect ?? inspectMarkdownFile;
  const formatSummary = dependencies.formatSummary ?? formatInspectSummary;
  const stderr = dependencies.stderr ?? ((message: string) => process.stderr.write(message));

  pi.registerCommand(INSPECT_COMMAND_NAME, {
    description: "Inspect one top-level Markdown file under docs/learning",
    getArgumentCompletions(argumentPrefix) {
      if (/\s/u.test(argumentPrefix)) return null;
      if (!INSPECT_COMMAND_COMPLETION_FILE.startsWith(argumentPrefix)) return null;
      return [
        {
          value: INSPECT_COMMAND_COMPLETION_FILE,
          label: INSPECT_COMMAND_COMPLETION_FILE,
          description: "Inspect the Pi Extensions learning note",
        },
      ];
    },
    async handler(args, ctx) {
      let file: string;
      try {
        file = parseCommandFile(args);
      } catch (error) {
        emitFeedback(ctx, stderr, stableErrorMessage(error), "error");
        return;
      }

      const signal = ctx.signal;
      let message: string;
      let level: FeedbackLevel;
      try {
        const details = await inspect({ cwd: ctx.cwd, file, signal });
        message = formatSummary(details);
        level = "info";
      } catch (error) {
        message = stableErrorMessage(error);
        level = "error";
      }
      emitFeedback(ctx, stderr, message, level);
    },
  });
}
