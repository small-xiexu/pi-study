import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

import {
  INSPECT_FIELD_MAX_CHARS,
  INSPECT_SAMPLE_LIMIT,
  type InspectSample,
} from "./markdown-inspection.ts";
import { validateInspectFileName } from "./inspect-path.ts";
import {
  formatInspectSummary,
  inspectMarkdownFile,
  type InspectDetails,
  type InspectServiceDependencies,
} from "./inspect-service.ts";

export type { InspectDetails } from "./inspect-service.ts";

export const INSPECT_TOOL_NAME = "pi_study_inspect";

export const InspectParams = Type.Object(
  {
    file: Type.String({
      description: "Top-level Markdown filename under docs/learning, for example 06-extensions.md",
      minLength: 4,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,124}\\.md$",
    }),
  },
  { additionalProperties: false },
);

const RENDER_FILE_MAX_CHARS = 128;
const RENDER_MESSAGE_MAX_CHARS = 320;

function renderSample(sample: InspectSample): string {
  if (sample.kind === "heading") return `- H${sample.level} ${sample.text}`;
  return `- LINK ${sample.text} -> ${sample.target}`;
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content.find((content) => content.type === "text");
  return item?.text ?? "Inspection result unavailable";
}

function sanitizeRenderText(value: string, maxChars: number): string {
  const clean = stripTerminalSequences(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const codePoints = Array.from(clean);
  if (codePoints.length <= maxChars) return clean;
  return `${codePoints.slice(0, maxChars - 3).join("")}...`;
}

function isBoundedSafeText(value: unknown, maxChars: number): value is string {
  return (
    typeof value === "string" &&
    Array.from(value).length <= maxChars &&
    sanitizeRenderText(value, maxChars) === value
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isInspectSample(value: unknown): value is InspectSample {
  if (typeof value !== "object" || value === null) return false;
  const sample = value as Partial<InspectSample> & { kind?: unknown };
  if (sample.kind === "heading") {
    return (
      Number.isInteger(sample.level) &&
      typeof sample.level === "number" &&
      sample.level >= 1 &&
      sample.level <= 6 &&
      isBoundedSafeText(sample.text, INSPECT_FIELD_MAX_CHARS)
    );
  }
  if (sample.kind === "link") {
    return (
      isBoundedSafeText(sample.text, INSPECT_FIELD_MAX_CHARS) &&
      isBoundedSafeText(sample.target, INSPECT_FIELD_MAX_CHARS)
    );
  }
  return false;
}

function isInspectDetails(value: unknown): value is InspectDetails {
  if (typeof value !== "object" || value === null) return false;
  const details = value as Partial<InspectDetails>;
  if (
    !isBoundedSafeText(details.file, RENDER_FILE_MAX_CHARS) ||
    !isNonNegativeInteger(details.headingCount) ||
    !isNonNegativeInteger(details.linkCount) ||
    !isNonNegativeInteger(details.shownCount) ||
    details.sampleLimit !== INSPECT_SAMPLE_LIMIT ||
    typeof details.truncated !== "boolean" ||
    !Array.isArray(details.samples) ||
    details.samples.length > INSPECT_SAMPLE_LIMIT ||
    details.shownCount !== details.samples.length ||
    !details.samples.every(isInspectSample) ||
    !Array.isArray(details.truncationReasons) ||
    details.truncationReasons.length > 2 ||
    !details.truncationReasons.every(
      (reason) => reason === "sample_limit" || reason === "field_limit",
    ) ||
    details.truncated !== (details.truncationReasons.length > 0)
  ) {
    return false;
  }
  try {
    validateInspectFileName(details.file);
  } catch {
    return false;
  }
  const headingSamples = details.samples.filter((sample) => sample.kind === "heading").length;
  const linkSamples = details.samples.filter((sample) => sample.kind === "link").length;
  return details.headingCount >= headingSamples && details.linkCount >= linkSamples;
}

export function createPiStudyInspectTool(
  dependencies: InspectServiceDependencies = {},
): ToolDefinition<typeof InspectParams, InspectDetails> {
  return {
    name: INSPECT_TOOL_NAME,
    label: "Pi Study Inspect",
    description:
      "Inspect one top-level Markdown file under docs/learning. Count headings and Markdown links, return at most 20 ordered samples, and never modify files, execute shell commands, or follow links.",
    promptSnippet: "Inspect headings and Markdown links in one docs/learning file",
    parameters: InspectParams,

    async execute(_toolCallId, params: Static<typeof InspectParams>, signal, _onUpdate, ctx) {
      const details = await inspectMarkdownFile(
        { cwd: ctx.cwd, file: params.file, signal },
        dependencies,
      );
      return {
        content: [{ type: "text", text: formatInspectSummary(details) }],
        details,
      };
    },

    renderCall(args, theme) {
      const rawFile = (args as { file?: unknown }).file;
      const sanitized =
        typeof rawFile === "string" ? sanitizeRenderText(rawFile, RENDER_FILE_MAX_CHARS) : "";
      const file = sanitized || "Markdown file";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("Pi Study Inspect"))} ${theme.fg("accent", file)}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Inspecting Markdown..."), 0, 0);
      }
      if (context.isError) {
        return new Text(
          theme.fg("error", sanitizeRenderText(firstText(result), RENDER_MESSAGE_MAX_CHARS)),
          0,
          0,
        );
      }
      if (!isInspectDetails(result.details)) {
        return new Text(
          theme.fg("muted", sanitizeRenderText(firstText(result), RENDER_MESSAGE_MAX_CHARS)),
          0,
          0,
        );
      }

      const details = result.details;
      const headingLabel = details.headingCount === 1 ? "heading" : "headings";
      const linkLabel = details.linkCount === 1 ? "link" : "links";
      let text = theme.fg(
        "success",
        `${details.headingCount} ${headingLabel} | ${details.linkCount} ${linkLabel}`,
      );
      if (details.truncated) text += theme.fg("warning", " | truncated");
      if (expanded && details.samples.length > 0) {
        text += `\n${details.samples.map(renderSample).map((line) => theme.fg("dim", line)).join("\n")}`;
      }
      return new Text(text, 0, 0);
    },
  };
}

export function registerPiStudyInspect(pi: Pick<ExtensionAPI, "registerTool">): void {
  pi.registerTool(createPiStudyInspectTool());
}
