import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  INSPECT_COMMAND_NAME,
  registerStudyInspectCommand,
} from "../inspect-command.ts";
import { formatInspectSummary, inspectMarkdownFile } from "../inspect-service.ts";
import { createPiStudyInspectTool, type InspectDetails } from "../inspect-tool.ts";

type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];

const DETAILS: InspectDetails = {
  file: "06-extensions.md",
  headingCount: 40,
  linkCount: 7,
  shownCount: 1,
  sampleLimit: 20,
  samples: [{ kind: "heading", level: 1, text: "Pi Extensions" }],
  truncated: true,
  truncationReasons: ["sample_limit"],
};

const SUMMARY = "File: 06-extensions.md\nHeadings: 40\nLinks: 7\nTruncated: true";

interface InspectCall {
  cwd: string;
  file: string;
  signal?: AbortSignal;
}

function registerCommand(options: {
  inspectCalls?: InspectCall[];
  stderr?: string[];
  formatCalls?: InspectDetails[];
  inspect?: (request: InspectCall) => Promise<InspectDetails>;
  formatSummary?: (details: InspectDetails) => string;
} = {}): CommandOptions {
  let command: CommandOptions | undefined;
  registerStudyInspectCommand(
    {
      registerCommand(name, registered) {
        assert.equal(name, INSPECT_COMMAND_NAME);
        command = registered;
      },
    } as Pick<ExtensionAPI, "registerCommand">,
    {
      inspect:
        options.inspect ??
        (async (request) => {
          options.inspectCalls?.push(request);
          return DETAILS;
        }),
      formatSummary:
        options.formatSummary ??
        ((details) => {
          options.formatCalls?.push(details);
          return SUMMARY;
        }),
      stderr: (message) => options.stderr?.push(message),
    },
  );
  assert.ok(command);
  return command;
}

test("the study-inspect Command registers one direct and discoverable contract", async () => {
  const inspectCalls: InspectCall[] = [];
  const command = registerCommand({ inspectCalls });

  assert.equal(INSPECT_COMMAND_NAME, "study-inspect");
  assert.match(command.description ?? "", /Markdown/);
  assert.ok(command.getArgumentCompletions);

  const all = await command.getArgumentCompletions("");
  assert.deepEqual(
    all?.map(({ value, label }) => ({ value, label })),
    [{ value: "06-extensions.md", label: "06-extensions.md" }],
  );
  const matching = await command.getArgumentCompletions("06-ext");
  assert.deepEqual(
    matching?.map(({ value, label }) => ({ value, label })),
    [{ value: "06-extensions.md", label: "06-extensions.md" }],
  );
  assert.equal(await command.getArgumentCompletions("other"), null);
  assert.equal(await command.getArgumentCompletions("06-extensions.md extra"), null);

  // 补全函数没有 Command Context；这里仅证明固定建议不会偷跑共享检查服务。
  assert.deepEqual(inspectCalls, []);
});

test("the default Command and Tool adapters produce the same summary from one real file", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-study-inspect-command."));
  const learningRoot = join(cwd, "docs", "learning");
  mkdirSync(learningRoot, { recursive: true });
  writeFileSync(join(learningRoot, "lesson.md"), "# One\n\n## Two [link](target.md)\n", "utf8");
  writeFileSync(
    join(learningRoot, "large.md"),
    Array.from({ length: 25 }, (_, index) => `# Heading ${index + 1}`).join("\n\n"),
    "utf8",
  );
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  let command: CommandOptions | undefined;
  registerStudyInspectCommand(
    {
      registerCommand(name, registered) {
        assert.equal(name, INSPECT_COMMAND_NAME);
        command = registered;
      },
    } as Pick<ExtensionAPI, "registerCommand">,
    {
      stderr() {
        assert.fail("TUI must not use stderr");
      },
    },
  );
  assert.ok(command);

  for (const file of ["lesson.md", "large.md"]) {
    const notifications: Array<{ message: string; level: string }> = [];
    await command.handler(file, {
      mode: "tui",
      hasUI: true,
      cwd,
      signal: undefined,
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    } as any);

    const toolResult = await createPiStudyInspectTool().execute(
      `call-shared-command-${file}`,
      { file },
      undefined,
      undefined,
      { cwd } as any,
    );
    assert.equal(toolResult.content[0]?.type, "text");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.level, "info");
    if (toolResult.content[0]?.type === "text") {
      assert.equal(notifications[0]?.message, toolResult.content[0].text);
      if (file === "large.md") {
        assert.match(toolResult.content[0].text, /Truncated: true/u);
      }
    }
  }
});

test("the main factory default JSON Command keeps stdout clean and writes one stderr summary", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-study-inspect-command-process."));
  const learningRoot = join(cwd, "docs", "learning");
  mkdirSync(learningRoot, { recursive: true });
  writeFileSync(join(learningRoot, "lesson.md"), "# One\n\n[link](target.md)\n", "utf8");
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const expected = `${formatInspectSummary(
    await inspectMarkdownFile({ cwd, file: "lesson.md" }),
  )}\n`;
  const extensionUrl = new URL("../index.ts", import.meta.url).href;
  const script = `
    import registerPiStudyGuard from ${JSON.stringify(extensionUrl)};

    let command;
    registerPiStudyGuard({
      registerFlag() {},
      on() {},
      registerTool() {},
      registerCommand(name, options) {
        if (name === "study-inspect") command = options;
      },
    });
    if (!command) throw new Error("study-inspect was not registered");
    await command.handler("lesson.md", {
      mode: "json",
      hasUI: false,
      cwd: ${JSON.stringify(cwd)},
      signal: undefined,
      ui: { notify() { throw new Error("JSON must not notify"); } },
    });
  `;
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
  delete childEnvironment.PI_STUDY_LIFECYCLE_TRACE;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: childEnvironment,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, expected);
});

test("the study-inspect Command passes one Context snapshot to the shared service and notifies TUI once", async () => {
  const inspectCalls: InspectCall[] = [];
  const formatCalls: InspectDetails[] = [];
  const stderr: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const command = registerCommand({ inspectCalls, formatCalls, stderr });
  const firstSignal = new AbortController().signal;
  const laterSignal = new AbortController().signal;
  let signalReads = 0;
  const context = {
    mode: "tui",
    hasUI: true,
    cwd: "/session/project",
    get signal() {
      signalReads += 1;
      return signalReads === 1 ? firstSignal : laterSignal;
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  } as any;

  const result = await command.handler("  06-extensions.md  ", context);

  assert.equal(result, undefined);
  assert.equal(signalReads, 1);
  assert.deepEqual(inspectCalls, [
    { cwd: "/session/project", file: "06-extensions.md", signal: firstSignal },
  ]);
  assert.deepEqual(formatCalls, [DETAILS]);
  assert.deepEqual(notifications, [{ message: SUMMARY, level: "info" }]);
  assert.deepEqual(stderr, []);

  // Fake 只证明 Handler 的公开返回值为 void；它不冒充真实 Pi 的 0 Model/0 Tool Result 证据。
});

test("the study-inspect Command writes the same bounded summary once to stderr in Print and JSON", async (t) => {
  for (const mode of ["print", "json"] as const) {
    await t.test(mode, async () => {
      const inspectCalls: InspectCall[] = [];
      const stderr: string[] = [];
      const command = registerCommand({ inspectCalls, stderr });
      const signal = new AbortController().signal;

      const result = await command.handler("06-extensions.md", {
        mode,
        hasUI: false,
        cwd: `/session/${mode}`,
        signal,
        ui: {
          notify() {
            assert.fail(`${mode} must not use ui.notify`);
          },
        },
      } as any);

      assert.equal(result, undefined);
      assert.deepEqual(inspectCalls, [
        { cwd: `/session/${mode}`, file: "06-extensions.md", signal },
      ]);
      assert.equal(stderr.length, 1);
      assert.equal(stderr[0]?.trimEnd(), SUMMARY);
    });
  }
});

test("the study-inspect Command uses the available RPC notification channel", async () => {
  const stderr: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const command = registerCommand({ stderr });

  await command.handler("06-extensions.md", {
    mode: "rpc",
    hasUI: true,
    cwd: "/session/rpc",
    signal: undefined,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  } as any);

  assert.deepEqual(notifications, [{ message: SUMMARY, level: "info" }]);
  assert.deepEqual(stderr, []);
});

test("the study-inspect Command reports service failures once without leaking unknown details", async (t) => {
  await t.test("known contract errors use the TUI error channel", async () => {
    const notifications: Array<{ message: string; level: string }> = [];
    const stderr: string[] = [];
    const command = registerCommand({
      stderr,
      inspect: async () => {
        throw new Error("PI_STUDY_INSPECT_NOT_FOUND file=lesson.md");
      },
    });

    const result = await command.handler("lesson.md", {
      mode: "tui",
      hasUI: true,
      cwd: "/unused",
      signal: undefined,
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    } as any);

    assert.equal(result, undefined);
    assert.deepEqual(notifications, [
      { message: "PI_STUDY_INSPECT_NOT_FOUND file=lesson.md", level: "error" },
    ]);
    assert.deepEqual(stderr, []);
  });

  await t.test("unknown errors become one stable Print fallback", async () => {
    const stderr: string[] = [];
    const command = registerCommand({
      stderr,
      inspect: async () => {
        throw new Error("SECRET SERVICE DETAIL");
      },
    });

    const result = await command.handler("lesson.md", {
      mode: "print",
      hasUI: false,
      cwd: "/unused",
      signal: undefined,
      ui: {
        notify() {
          assert.fail("Print must not use ui.notify");
        },
      },
    } as any);

    assert.equal(result, undefined);
    assert.deepEqual(stderr, ["PI_STUDY_INSPECT_COMMAND_FAILED\n"]);
    assert.equal(stderr.join("").includes("SECRET SERVICE DETAIL"), false);
  });

  await t.test("formatter errors become one stable Print fallback", async () => {
    const stderr: string[] = [];
    const command = registerCommand({
      stderr,
      formatSummary() {
        throw new Error("SECRET FORMAT DETAIL");
      },
    });

    const result = await command.handler("lesson.md", {
      mode: "print",
      hasUI: false,
      cwd: "/unused",
      signal: undefined,
      ui: {
        notify() {
          assert.fail("Print must not use ui.notify");
        },
      },
    } as any);

    assert.equal(result, undefined);
    assert.deepEqual(stderr, ["PI_STUDY_INSPECT_COMMAND_FAILED\n"]);
    assert.equal(stderr.join("").includes("SECRET FORMAT DETAIL"), false);
  });
});

test("the study-inspect Command rejects missing, unknown, and invalid arguments before inspection", async (t) => {
  const cases = [
    { args: "   ", error: "PI_STUDY_INSPECT_COMMAND_FILE_REQUIRED" },
    { args: "lesson.md extra.md", error: "PI_STUDY_INSPECT_COMMAND_UNKNOWN_ARGUMENT" },
    { args: "--file", error: "PI_STUDY_INSPECT_COMMAND_UNKNOWN_ARGUMENT" },
    { args: "../lesson.md", error: "PI_STUDY_INSPECT_INVALID_FILE" },
    { args: "lesson.txt", error: "PI_STUDY_INSPECT_INVALID_FILE" },
  ];

  for (const entry of cases) {
    await t.test(entry.args || "empty", async () => {
      const inspectCalls: InspectCall[] = [];
      const formatCalls: InspectDetails[] = [];
      const notifications: Array<{ message: string; level: string }> = [];
      const command = registerCommand({ inspectCalls, formatCalls });

      const result = await command.handler(entry.args, {
        mode: "tui",
        hasUI: true,
        cwd: "/must-not-be-used",
        signal: undefined,
        ui: {
          notify(message: string, level: string) {
            notifications.push({ message, level });
          },
        },
      } as any);

      assert.equal(result, undefined);
      assert.deepEqual(inspectCalls, []);
      assert.deepEqual(formatCalls, []);
      assert.deepEqual(notifications, [{ message: entry.error, level: "error" }]);
    });
  }
});

test("the study-inspect Command routes an argument error to stderr when UI is unavailable", async () => {
  const inspectCalls: InspectCall[] = [];
  const stderr: string[] = [];
  const command = registerCommand({ inspectCalls, stderr });

  const result = await command.handler("", {
    mode: "print",
    hasUI: false,
    cwd: "/must-not-be-used",
    signal: undefined,
    ui: {
      notify() {
        assert.fail("Print must not use ui.notify");
      },
    },
  } as any);

  assert.equal(result, undefined);
  assert.deepEqual(inspectCalls, []);
  assert.equal(stderr.length, 1);
  assert.equal(stderr[0]?.trimEnd(), "PI_STUDY_INSPECT_COMMAND_FILE_REQUIRED");
});
