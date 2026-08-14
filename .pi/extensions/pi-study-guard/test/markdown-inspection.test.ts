import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeMarkdown,
  INSPECT_FIELD_MAX_CHARS,
  INSPECT_SAMPLE_LIMIT,
} from "../markdown-inspection.ts";

test("the Markdown analyzer counts syntax nodes rather than code-shaped text", () => {
  const markdown = `# ATX [inline](inline.md)

Setext [reference][ref]
===

<https://example.com>

![image](image.png)

\`# inline code [fake](inline-fake.md)\`

\`\`\`markdown
# fenced fake [fake](fenced-fake.md)
\`\`\`

<a href="raw.html">raw HTML is not a Markdown link token</a>

[ref]: target.md
`;

  assert.deepEqual(analyzeMarkdown(markdown), {
    headingCount: 2,
    linkCount: 3,
    shownCount: 5,
    sampleLimit: INSPECT_SAMPLE_LIMIT,
    samples: [
      { kind: "heading", level: 1, text: "ATX inline" },
      { kind: "link", text: "inline", target: "inline.md" },
      { kind: "heading", level: 1, text: "Setext reference" },
      { kind: "link", text: "reference", target: "target.md" },
      { kind: "link", text: "https://example.com", target: "https://example.com" },
    ],
    truncated: false,
    truncationReasons: [],
  });
});

test("the Markdown analyzer treats an empty document as a valid empty result", () => {
  assert.deepEqual(analyzeMarkdown(""), {
    headingCount: 0,
    linkCount: 0,
    shownCount: 0,
    sampleLimit: INSPECT_SAMPLE_LIMIT,
    samples: [],
    truncated: false,
    truncationReasons: [],
  });
});

test("the Markdown analyzer returns at most twenty ordered and bounded samples", () => {
  const markdown = Array.from(
    { length: INSPECT_SAMPLE_LIMIT + 2 },
    (_, index) => `# Heading ${index + 1} [link ${index + 1}](target-${index + 1}.md)`,
  ).join("\n\n");

  const result = analyzeMarkdown(markdown);

  assert.equal(result.headingCount, INSPECT_SAMPLE_LIMIT + 2);
  assert.equal(result.linkCount, INSPECT_SAMPLE_LIMIT + 2);
  assert.equal(result.shownCount, INSPECT_SAMPLE_LIMIT);
  assert.equal(result.samples.length, INSPECT_SAMPLE_LIMIT);
  assert.deepEqual(result.samples.slice(0, 3), [
    { kind: "heading", level: 1, text: "Heading 1 link 1" },
    { kind: "link", text: "link 1", target: "target-1.md" },
    { kind: "heading", level: 1, text: "Heading 2 link 2" },
  ]);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.truncationReasons, ["sample_limit"]);
});

test("the Markdown analyzer removes control characters and bounds individual fields", () => {
  const longText = `visible\u001b[31m${"x".repeat(400)}`;
  const result = analyzeMarkdown(`# ${longText}\n\n[${longText}](https://example.com/${"y".repeat(400)})`);

  assert.equal(result.samples.length, 2);
  assert.ok(result.samples.every((sample) => !JSON.stringify(sample).includes("\u001b")));
  assert.ok(result.samples.every((sample) => sample.text.length === INSPECT_FIELD_MAX_CHARS));
  assert.ok(result.samples.every((sample) => sample.text.endsWith("...")));
  const link = result.samples[1];
  assert.equal(link?.kind, "link");
  if (link?.kind === "link") {
    assert.equal(link.target.length, INSPECT_FIELD_MAX_CHARS);
    assert.ok(link.target.endsWith("..."));
  }
  assert.equal(result.truncated, true);
  assert.deepEqual(result.truncationReasons, ["field_limit"]);
});

test("the Markdown analyzer does not split Unicode surrogate pairs at the field limit", () => {
  const emoji = "😀".repeat(300);
  const result = analyzeMarkdown(`# ${emoji}`);
  const heading = result.samples[0];
  assert.equal(heading?.kind, "heading");
  if (heading?.kind === "heading") {
    assert.equal(Array.from(heading.text).length, INSPECT_FIELD_MAX_CHARS);
    assert.equal(heading.text.includes("�"), false);
    assert.ok(heading.text.endsWith("..."));
  }
});
