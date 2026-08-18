import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPiStudyInspectTool } from "../inspect-tool.ts";
import { formatInspectSummary, inspectMarkdownFile } from "../inspect-service.ts";

function createProject(t: test.TestContext): { cwd: string; learningRoot: string } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-study-inspect-service."));
  const learningRoot = join(cwd, "docs", "learning");
  mkdirSync(learningRoot, { recursive: true });
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, learningRoot };
}

const SMALL_INSPECTION = {
  headingCount: 1,
  linkCount: 0,
  shownCount: 1,
  sampleLimit: 20,
  samples: [{ kind: "heading" as const, level: 1, text: "Lesson" }],
  truncated: false,
  truncationReasons: [],
};

test("the shared inspect service reads a real Markdown path and owns the canonical summary", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  writeFileSync(join(learningRoot, "lesson.md"), "# One\n\n## Two [link](target.md)\n", "utf8");

  const details = await inspectMarkdownFile({ cwd, file: "lesson.md" });

  assert.deepEqual(details, {
    file: "lesson.md",
    headingCount: 2,
    linkCount: 1,
    shownCount: 3,
    sampleLimit: 20,
    samples: [
      { kind: "heading", level: 1, text: "One" },
      { kind: "heading", level: 2, text: "Two link" },
      { kind: "link", text: "link", target: "target.md" },
    ],
    truncated: false,
    truncationReasons: [],
  });

  const summary = formatInspectSummary(details);
  assert.equal(
    summary,
    [
      "File: lesson.md",
      "Headings: 2",
      "Links: 1",
      "Samples: 3/3",
      "Truncated: false",
      "Items:",
      "- H1 One",
      "- H2 Two link",
      "- LINK link -> target.md",
    ].join("\n"),
  );

  const tool = createPiStudyInspectTool();
  const toolResult = await tool.execute(
    "call-shared-summary",
    { file: "lesson.md" },
    undefined,
    undefined,
    { cwd } as any,
  );
  assert.equal(toolResult.content[0]?.type, "text");
  if (toolResult.content[0]?.type === "text") {
    assert.equal(toolResult.content[0].text, summary);
  }
});

test("the canonical summary stays bounded when the shared service truncates hostile input", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  const longHeading = `visible\u001b[31m${"x".repeat(400)}`;
  const markdown = Array.from({ length: 40 }, (_, index) => `# ${longHeading} ${index}`).join(
    "\n\n",
  );
  writeFileSync(join(learningRoot, "large.md"), markdown, "utf8");

  const details = await inspectMarkdownFile({ cwd, file: "large.md" });
  const summary = formatInspectSummary(details);

  assert.equal(details.shownCount, 20);
  assert.equal(details.truncated, true);
  assert.deepEqual(details.truncationReasons, ["sample_limit", "field_limit"]);
  assert.equal(summary.includes("\u001b"), false);
  assert.ok(Array.from(summary).length <= 5_000);
});

test("the shared inspect service passes only its explicit cwd, file, and signal to the reader", async () => {
  const controller = new AbortController();
  let receivedOptions: unknown;

  const details = await inspectMarkdownFile(
    { cwd: "/explicit/project", file: "lesson.md", signal: controller.signal },
    {
      readMarkdown: async (options) => {
        receivedOptions = options;
        return "# Lesson";
      },
      analyzeMarkdown: () => SMALL_INSPECTION,
    },
  );

  assert.deepEqual(receivedOptions, {
    cwd: "/explicit/project",
    file: "lesson.md",
    signal: controller.signal,
  });
  assert.deepEqual(details, { file: "lesson.md", ...SMALL_INSPECTION });
});

test("the shared inspect service rejects an invalid file before calling an injected reader", async () => {
  let readerCalled = false;

  await assert.rejects(
    inspectMarkdownFile(
      { cwd: "/unused", file: "../lesson.md" },
      {
        readMarkdown: async () => {
          readerCalled = true;
          return "# Must not be read";
        },
      },
    ),
    (error: Error) => error.message === "PI_STUDY_INSPECT_INVALID_FILE",
  );
  assert.equal(readerCalled, false);
});

test("the shared inspect service never disguises cancellation or read failure as success", async (t) => {
  await t.test("a signal already cancelled rejects before reading", async () => {
    const controller = new AbortController();
    controller.abort();
    let readerCalled = false;

    await assert.rejects(
      inspectMarkdownFile(
        { cwd: "/unused", file: "lesson.md", signal: controller.signal },
        {
          readMarkdown: async () => {
            readerCalled = true;
            return "# Must not be read";
          },
        },
      ),
      /PI_STUDY_INSPECT_CANCELLED/,
    );
    assert.equal(readerCalled, false);
  });

  await t.test("cancellation after reading rejects before parsing", async () => {
    const controller = new AbortController();
    let parserCalled = false;

    await assert.rejects(
      inspectMarkdownFile(
        { cwd: "/unused", file: "lesson.md", signal: controller.signal },
        {
          readMarkdown: async () => {
            controller.abort();
            return "# Must not be parsed";
          },
          analyzeMarkdown: () => {
            parserCalled = true;
            return SMALL_INSPECTION;
          },
        },
      ),
      /PI_STUDY_INSPECT_CANCELLED/,
    );
    assert.equal(parserCalled, false);
  });

  await t.test("an unknown reader error is mapped without leaking its details", async () => {
    await assert.rejects(
      inspectMarkdownFile(
        { cwd: "/unused", file: "lesson.md" },
        {
          readMarkdown: async () => {
            throw new Error("SECRET READ DETAIL");
          },
        },
      ),
      (error: Error) =>
        error.message === "PI_STUDY_INSPECT_READ_FAILED file=lesson.md" &&
        !error.message.includes("SECRET READ DETAIL"),
    );
  });
});
