import { Marked, stripTerminalSequences, type Token } from "@earendil-works/pi-tui";

export const INSPECT_SAMPLE_LIMIT = 20;
export const INSPECT_FIELD_MAX_CHARS = 160;

export type InspectTruncationReason = "sample_limit" | "field_limit";

export type InspectSample =
  | { kind: "heading"; level: number; text: string }
  | { kind: "link"; text: string; target: string };

export interface MarkdownInspection {
  headingCount: number;
  linkCount: number;
  shownCount: number;
  sampleLimit: number;
  samples: InspectSample[];
  truncated: boolean;
  truncationReasons: InspectTruncationReason[];
}

type InlineToken = Token & {
  text?: string;
  tokens?: Token[];
};

function tokenText(tokens: Token[] | undefined): string {
  if (!tokens) return "";

  return tokens
    .map((token) => {
      const inline = token as InlineToken;
      if (inline.tokens) return tokenText(inline.tokens);
      if (token.type === "br") return " ";
      if (token.type === "image") return inline.text ?? "";
      if (token.type === "html") return "";
      return inline.text ?? "";
    })
    .join("");
}

function sanitizeField(value: string): { value: string; truncated: boolean } {
  const clean = stripTerminalSequences(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const codePoints = Array.from(clean);
  if (codePoints.length <= INSPECT_FIELD_MAX_CHARS) {
    return { value: clean, truncated: false };
  }
  return {
    value: `${codePoints.slice(0, INSPECT_FIELD_MAX_CHARS - 3).join("")}...`,
    truncated: true,
  };
}

export function analyzeMarkdown(source: string): MarkdownInspection {
  const parser = new Marked();
  const tokens = parser.lexer(source);
  const samples: InspectSample[] = [];
  let headingCount = 0;
  let linkCount = 0;
  let fieldTruncated = false;

  parser.walkTokens(tokens, (token) => {
    if (token.type === "heading") {
      headingCount += 1;
      if (samples.length < INSPECT_SAMPLE_LIMIT) {
        const text = sanitizeField(tokenText(token.tokens));
        fieldTruncated ||= text.truncated;
        samples.push({ kind: "heading", level: token.depth, text: text.value });
      }
      return;
    }

    if (token.type === "link") {
      linkCount += 1;
      if (samples.length < INSPECT_SAMPLE_LIMIT) {
        const text = sanitizeField(tokenText(token.tokens));
        const target = sanitizeField(token.href);
        fieldTruncated ||= text.truncated || target.truncated;
        samples.push({ kind: "link", text: text.value, target: target.value });
      }
    }
  });

  const reasons: InspectTruncationReason[] = [];
  if (headingCount + linkCount > samples.length) reasons.push("sample_limit");
  if (fieldTruncated) reasons.push("field_limit");

  return {
    headingCount,
    linkCount,
    shownCount: samples.length,
    sampleLimit: INSPECT_SAMPLE_LIMIT,
    samples,
    truncated: reasons.length > 0,
    truncationReasons: reasons,
  };
}
