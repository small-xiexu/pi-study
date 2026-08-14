import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/validation.js";

import {
  createPiStudyInspectTool,
  INSPECT_TOOL_NAME,
  registerPiStudyInspect,
} from "../inspect-tool.ts";

type RegisteredTool = Parameters<ExtensionAPI["registerTool"]>[0];

function createProject(t: test.TestContext): { cwd: string; learningRoot: string } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-study-inspect-tool."));
  const learningRoot = join(cwd, "docs", "learning");
  mkdirSync(learningRoot, { recursive: true });
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, learningRoot };
}

function registerTool(): RegisteredTool {
  const tools: RegisteredTool[] = [];
  registerPiStudyInspect({
    registerTool(tool) {
      tools.push(tool as RegisteredTool);
    },
  });
  assert.equal(tools.length, 1);
  return tools[0]!;
}

test("the inspect Tool registers one strict and discoverable contract", () => {
  const tool = registerTool();

  assert.equal(tool.name, INSPECT_TOOL_NAME);
  assert.equal(tool.label, "Pi Study Inspect");
  assert.match(tool.description, /docs\/learning/);
  assert.match(tool.promptSnippet ?? "", /Markdown/);
  const schema = tool.parameters as unknown as { type?: unknown; additionalProperties?: unknown };
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);

  assert.deepEqual(
    validateToolArguments(tool as any, {
      type: "toolCall",
      id: "call-1",
      name: INSPECT_TOOL_NAME,
      arguments: { file: "06-extensions.md" },
    }),
    { file: "06-extensions.md" },
  );

  for (const args of [{}, { file: "06-extensions.md", extra: true }, { file: 42 }, { file: "../x.md" }]) {
    assert.throws(
      () =>
        validateToolArguments(tool as any, {
          type: "toolCall",
          id: "call-invalid",
          name: INSPECT_TOOL_NAME,
          arguments: args,
        }),
      /Validation failed/,
    );
  }
});

test("the inspect Executor returns bounded content and structured details", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  writeFileSync(join(learningRoot, "lesson.md"), "# One\n\n## Two [link](target.md)\n", "utf8");
  const tool = registerTool();

  const result = await tool.execute("call-1", { file: "lesson.md" }, undefined, undefined, { cwd } as any);

  assert.deepEqual(result.details, {
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
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]?.type, "text");
  if (result.content[0]?.type === "text") {
    assert.match(result.content[0].text, /File: lesson\.md/);
    assert.match(result.content[0].text, /Headings: 2/);
    assert.match(result.content[0].text, /Links: 1/);
    assert.match(result.content[0].text, /Samples: 3\/3/);
    assert.match(result.content[0].text, /Truncated: false/);
  }
});

test("the inspect Executor uses its explicit signal and maps parser failures to stable errors", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const tool = createPiStudyInspectTool({
    readMarkdown: async ({ signal }) => {
      receivedSignal = signal;
      return "# Valid";
    },
    analyzeMarkdown: () => {
      throw new Error("SECRET PARSER DETAIL");
    },
  });

  await assert.rejects(
    tool.execute("call-1", { file: "lesson.md" }, controller.signal, undefined, { cwd: "/unused" } as any),
    (error: Error) =>
      error.message === "PI_STUDY_INSPECT_PARSE_FAILED file=lesson.md" &&
      !error.message.includes("SECRET PARSER DETAIL"),
  );
  assert.equal(receivedSignal, controller.signal);
});

test("the inspect Executor maps unknown read failures without leaking their details", async () => {
  const tool = createPiStudyInspectTool({
    readMarkdown: async () => {
      throw new Error("SECRET READ DETAIL");
    },
  });

  await assert.rejects(
    tool.execute("call-1", { file: "lesson.md" }, undefined, undefined, { cwd: "/unused" } as any),
    (error: Error) =>
      error.message === "PI_STUDY_INSPECT_READ_FAILED file=lesson.md" &&
      !error.message.includes("SECRET READ DETAIL"),
  );
});

test("the inspect Executor never converts cancellation at any work boundary into success", async (t) => {
  const controller = new AbortController();
  controller.abort();
  const preAbortedTool = createPiStudyInspectTool();

  await assert.rejects(
    preAbortedTool.execute("call-1", { file: "lesson.md" }, controller.signal, undefined, {
      cwd: "/unused",
    } as any),
    /PI_STUDY_INSPECT_CANCELLED/,
  );

  await t.test("after reading and before parsing", async () => {
    const afterReadController = new AbortController();
    let parserCalled = false;
    const tool = createPiStudyInspectTool({
      readMarkdown: async () => {
        afterReadController.abort();
        return "# Never parsed";
      },
      analyzeMarkdown: () => {
        parserCalled = true;
        throw new Error("parser must not run");
      },
    });

    await assert.rejects(
      tool.execute("call-2", { file: "lesson.md" }, afterReadController.signal, undefined, {
        cwd: "/unused",
      } as any),
      /PI_STUDY_INSPECT_CANCELLED/,
    );
    assert.equal(parserCalled, false);
  });

  await t.test("after parsing and before returning", async () => {
    const afterParseController = new AbortController();
    const tool = createPiStudyInspectTool({
      readMarkdown: async () => "# Parsed once",
      analyzeMarkdown: () => {
        afterParseController.abort();
        return {
          headingCount: 1,
          linkCount: 0,
          shownCount: 1,
          sampleLimit: 20,
          samples: [{ kind: "heading", level: 1, text: "Parsed once" }],
          truncated: false,
          truncationReasons: [],
        };
      },
    });

    await assert.rejects(
      tool.execute("call-3", { file: "lesson.md" }, afterParseController.signal, undefined, {
        cwd: "/unused",
      } as any),
      /PI_STUDY_INSPECT_CANCELLED/,
    );
  });
});

test("the custom renderers separate call, success, expanded, partial, and error views", () => {
  const tool = registerTool();
  assert.ok(tool.renderCall);
  assert.ok(tool.renderResult);
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any;
  const renderContext = { argsComplete: true, isError: false } as any;

  const callText = tool.renderCall({ file: "lesson.md" }, theme, renderContext).render(120).join("\n");
  assert.match(callText, /lesson\.md/);

  const result = {
    content: [{ type: "text" as const, text: "Model-facing result" }],
    details: {
      file: "lesson.md",
      headingCount: 2,
      linkCount: 1,
      shownCount: 1,
      sampleLimit: 20,
      samples: [{ kind: "heading" as const, level: 1, text: "One" }],
      truncated: true,
      truncationReasons: ["sample_limit" as const],
    },
  };
  const compact = tool
    .renderResult(result, { expanded: false, isPartial: false } as any, theme, renderContext)
    .render(120)
    .join("\n");
  assert.match(compact, /2 headings/);
  assert.match(compact, /1 link/);
  assert.match(compact, /truncated/);
  assert.doesNotMatch(compact, /One/);

  const expanded = tool
    .renderResult(result, { expanded: true, isPartial: false } as any, theme, renderContext)
    .render(120)
    .join("\n");
  assert.match(expanded, /One/);

  const partial = tool
    .renderResult(result, { expanded: false, isPartial: true } as any, theme, renderContext)
    .render(120)
    .join("\n");
  assert.match(partial, /Inspecting/);

  const error = tool
    .renderResult(
      { content: [{ type: "text", text: "PI_STUDY_INSPECT_NOT_FOUND" }], details: {} as any },
      { expanded: false, isPartial: false } as any,
      theme,
      { argsComplete: true, isError: true } as any,
    )
    .render(120)
    .join("\n");
  assert.match(error, /PI_STUDY_INSPECT_NOT_FOUND/);

  const fallback = tool
    .renderResult(
      { content: [{ type: "text", text: "Model-facing fallback" }], details: {} as any },
      { expanded: false, isPartial: false } as any,
      theme,
      { argsComplete: true, isError: false } as any,
    )
    .render(120)
    .join("\n");
  assert.match(fallback, /Model-facing fallback/);
});

test("the custom renderers sanitize and bound every untrusted input path", () => {
  const tool = registerTool();
  assert.ok(tool.renderCall);
  assert.ok(tool.renderResult);
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any;
  const hostile = `\u001b]8;;https://example.com\u0007${"x".repeat(5_000)}\u001b]8;;\u0007`;

  const call = tool
    .renderCall({ file: hostile }, theme, { argsComplete: false, isError: false } as any)
    .render(10_000)
    .map((line) => line.trimEnd())
    .join("\n");
  assert.equal(call.includes("\u001b"), false);
  assert.ok(Array.from(call).length < 200);

  const error = tool
    .renderResult(
      { content: [{ type: "text", text: hostile }], details: {} as any },
      { expanded: false, isPartial: false } as any,
      theme,
      { argsComplete: true, isError: true } as any,
    )
    .render(10_000)
    .map((line) => line.trimEnd())
    .join("\n");
  assert.equal(error.includes("\u001b"), false);
  assert.ok(Array.from(error).length <= 320);

  const forgedSamples = Array.from({ length: 100 }, () => ({
    kind: "heading" as const,
    level: 1,
    text: hostile,
  }));
  const fallback = tool
    .renderResult(
      {
        content: [{ type: "text", text: hostile }],
        details: {
          file: "lesson.md",
          headingCount: 100,
          linkCount: 0,
          shownCount: 100,
          sampleLimit: 20,
          samples: forgedSamples,
          truncated: true,
          truncationReasons: ["sample_limit"],
        } as any,
      },
      { expanded: true, isPartial: false } as any,
      theme,
      { argsComplete: true, isError: false } as any,
    )
    .render(10_000)
    .map((line) => line.trimEnd())
    .join("\n");
  assert.equal(fallback.includes("\u001b"), false);
  assert.ok(Array.from(fallback).length <= 320);
});
