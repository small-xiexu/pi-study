import {
  analyzeMarkdown,
  type InspectSample,
  type InspectTruncationReason,
  type MarkdownInspection,
} from "./markdown-inspection.ts";
import {
  readSafeMarkdownFile,
  throwIfInspectCancelled,
  validateInspectFileName,
  type SafeMarkdownReadOptions,
} from "./inspect-path.ts";

export interface InspectDetails {
  file: string;
  headingCount: number;
  linkCount: number;
  shownCount: number;
  sampleLimit: number;
  samples: InspectSample[];
  truncated: boolean;
  truncationReasons: InspectTruncationReason[];
}

export interface InspectRequest {
  cwd: string;
  file: string;
  signal?: AbortSignal;
}

export interface InspectServiceDependencies {
  readMarkdown?: (options: SafeMarkdownReadOptions) => Promise<string>;
  analyzeMarkdown?: (source: string) => MarkdownInspection;
}

function contractError(code: string, file?: string): Error {
  return new Error(file ? `${code} file=${file}` : code);
}

function isContractError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("PI_STUDY_INSPECT_");
}

function formatSample(sample: InspectSample): string {
  if (sample.kind === "heading") return `- H${sample.level} ${sample.text}`;
  return `- LINK ${sample.text} -> ${sample.target}`;
}

export function formatInspectSummary(details: InspectDetails): string {
  const totalItems = details.headingCount + details.linkCount;
  const lines = [
    `File: ${details.file}`,
    `Headings: ${details.headingCount}`,
    `Links: ${details.linkCount}`,
    `Samples: ${details.shownCount}/${totalItems}`,
    `Truncated: ${details.truncated}`,
  ];
  if (details.truncated) {
    lines.push(`Truncation reasons: ${details.truncationReasons.join(", ")}`);
  }
  if (details.samples.length > 0) {
    lines.push("Items:", ...details.samples.map(formatSample));
  }
  return lines.join("\n");
}

export async function inspectMarkdownFile(
  request: InspectRequest,
  dependencies: InspectServiceDependencies = {},
): Promise<InspectDetails> {
  const file = validateInspectFileName(request.file);
  const readMarkdown = dependencies.readMarkdown ?? readSafeMarkdownFile;
  const inspect = dependencies.analyzeMarkdown ?? analyzeMarkdown;
  throwIfInspectCancelled(request.signal);

  let source: string;
  try {
    source = await readMarkdown({ cwd: request.cwd, file, signal: request.signal });
  } catch (error) {
    if (request.signal?.aborted) throw contractError("PI_STUDY_INSPECT_CANCELLED");
    if (isContractError(error)) throw error;
    throw contractError("PI_STUDY_INSPECT_READ_FAILED", file);
  }
  throwIfInspectCancelled(request.signal);

  let inspection: MarkdownInspection;
  try {
    inspection = inspect(source);
  } catch {
    throw contractError("PI_STUDY_INSPECT_PARSE_FAILED", file);
  }
  throwIfInspectCancelled(request.signal);

  return { file, ...inspection };
}
