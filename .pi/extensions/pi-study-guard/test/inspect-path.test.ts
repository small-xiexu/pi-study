import assert from "node:assert/strict";
import { closeSync, fstatSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  INSPECT_INPUT_MAX_BYTES,
  readSafeMarkdownFile,
  sameFileSnapshot,
  validateInspectFileName,
} from "../inspect-path.ts";

function createProject(t: test.TestContext): { cwd: string; learningRoot: string } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-study-inspect-path."));
  const learningRoot = join(cwd, "docs", "learning");
  mkdirSync(learningRoot, { recursive: true });
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, learningRoot };
}

function expectClosed(fd: number): void {
  assert.throws(() => fstatSync(fd), (error: NodeJS.ErrnoException) => error.code === "EBADF");
}

test("the safe reader accepts one top-level Markdown basename and closes its descriptor", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  writeFileSync(join(learningRoot, "lesson.md"), "# Lesson\n", "utf8");
  let openedFd: number | undefined;

  const content = await readSafeMarkdownFile({
    cwd,
    file: "lesson.md",
    hooks: { onOpen: (fd) => (openedFd = fd) },
  });

  assert.equal(content, "# Lesson\n");
  assert.ok(openedFd !== undefined);
  expectClosed(openedFd);
});

test("the filename contract rejects traversal, separators, NUL, and non-Markdown names", () => {
  for (const file of [
    "",
    ".",
    "..",
    "../lesson.md",
    "nested/lesson.md",
    "nested\\lesson.md",
    "/tmp/lesson.md",
    "C:\\lesson.md",
    "lesson.MD",
    "lesson.txt",
    "lesson\0.md",
  ]) {
    assert.throws(() => validateInspectFileName(file), /PI_STUDY_INSPECT_INVALID_FILE/);
  }
  assert.equal(validateInspectFileName("06-extensions.md"), "06-extensions.md");
});

test("the safe reader rejects missing files and non-regular targets", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  mkdirSync(join(learningRoot, "directory.md"));

  await assert.rejects(
    readSafeMarkdownFile({ cwd, file: "missing.md" }),
    /PI_STUDY_INSPECT_NOT_FOUND file=missing.md/,
  );
  await assert.rejects(
    readSafeMarkdownFile({ cwd, file: "directory.md" }),
    /PI_STUDY_INSPECT_UNSAFE_FILE file=directory.md/,
  );
});

test("the safe reader rejects file, parent, and root symlinks", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  const outside = join(cwd, "outside.md");
  writeFileSync(outside, "# Outside\n", "utf8");
  symlinkSync(outside, join(learningRoot, "link.md"));

  await assert.rejects(
    readSafeMarkdownFile({ cwd, file: "link.md" }),
    /PI_STUDY_INSPECT_UNSAFE_FILE file=link.md/,
  );

  const parentCwd = mkdtempSync(join(tmpdir(), "pi-study-inspect-parent-link."));
  t.after(() => rmSync(parentCwd, { recursive: true, force: true }));
  mkdirSync(join(parentCwd, "real-docs", "learning"), { recursive: true });
  writeFileSync(join(parentCwd, "real-docs", "learning", "lesson.md"), "# Lesson\n", "utf8");
  symlinkSync(join(parentCwd, "real-docs"), join(parentCwd, "docs"));
  await assert.rejects(
    readSafeMarkdownFile({ cwd: parentCwd, file: "lesson.md" }),
    /PI_STUDY_INSPECT_UNSAFE_ROOT/,
  );

  const rootCwd = mkdtempSync(join(tmpdir(), "pi-study-inspect-root-link."));
  t.after(() => rmSync(rootCwd, { recursive: true, force: true }));
  mkdirSync(join(rootCwd, "docs", "real-learning"), { recursive: true });
  writeFileSync(join(rootCwd, "docs", "real-learning", "lesson.md"), "# Lesson\n", "utf8");
  symlinkSync(join(rootCwd, "docs", "real-learning"), join(rootCwd, "docs", "learning"));
  await assert.rejects(
    readSafeMarkdownFile({ cwd: rootCwd, file: "lesson.md" }),
    /PI_STUDY_INSPECT_UNSAFE_ROOT/,
  );
});

test("the safe reader rejects hard links and FIFOs without blocking", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  const original = join(cwd, "original.md");
  writeFileSync(original, "# Outside\n", "utf8");
  linkSync(original, join(learningRoot, "hard-link.md"));
  await assert.rejects(
    readSafeMarkdownFile({ cwd, file: "hard-link.md" }),
    /PI_STUDY_INSPECT_UNSAFE_FILE file=hard-link.md/,
  );

  const fifo = join(learningRoot, "pipe.md");
  const created = spawnSync("mkfifo", [fifo]);
  assert.equal(created.status, 0, created.stderr.toString("utf8"));
  await assert.rejects(
    readSafeMarkdownFile({ cwd, file: "pipe.md" }),
    /PI_STUDY_INSPECT_UNSAFE_FILE file=pipe.md/,
  );
});

test("the safe reader rejects oversized input and closes the descriptor", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  writeFileSync(join(learningRoot, "large.md"), Buffer.alloc(INSPECT_INPUT_MAX_BYTES + 1, 97));
  let openedFd: number | undefined;

  await assert.rejects(
    readSafeMarkdownFile({
      cwd,
      file: "large.md",
      hooks: { onOpen: (fd) => (openedFd = fd) },
    }),
    /PI_STUDY_INSPECT_INPUT_TOO_LARGE file=large.md/,
  );

  assert.ok(openedFd !== undefined);
  expectClosed(openedFd);
});

test("the safe reader rejects a file changed during chunked reading", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  const target = join(learningRoot, "changing.md");
  writeFileSync(target, "x".repeat(40_000), "utf8");
  let changed = false;

  await assert.rejects(
    readSafeMarkdownFile({
      cwd,
      file: "changing.md",
      hooks: {
        afterChunk() {
          if (!changed) {
            changed = true;
            writeFileSync(target, `${"x".repeat(40_000)}y`, "utf8");
          }
        },
      },
    }),
    /PI_STUDY_INSPECT_FILE_CHANGED file=changing.md/,
  );
});

test("the file snapshot compares nanoseconds instead of truncated milliseconds", () => {
  const base = {
    dev: 1n,
    ino: 2n,
    size: 3n,
    mtimeNs: 4_000_100n,
    ctimeNs: 5_000_100n,
  } as any;
  const changedWithinSameMillisecond = {
    ...base,
    mtimeNs: 4_000_900n,
    ctimeNs: 5_000_900n,
  } as any;

  assert.equal(base.mtimeNs / 1_000_000n, changedWithinSameMillisecond.mtimeNs / 1_000_000n);
  assert.equal(base.ctimeNs / 1_000_000n, changedWithinSameMillisecond.ctimeNs / 1_000_000n);
  assert.equal(sameFileSnapshot(base, changedWithinSameMillisecond), false);
});

test("the safe reader cooperates with cancellation before open and between chunks", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  writeFileSync(join(learningRoot, "cancel.md"), "x".repeat(40_000), "utf8");

  const beforeOpen = new AbortController();
  beforeOpen.abort();
  await assert.rejects(
    readSafeMarkdownFile({ cwd, file: "cancel.md", signal: beforeOpen.signal }),
    /PI_STUDY_INSPECT_CANCELLED/,
  );

  const betweenChunks = new AbortController();
  let openedFd: number | undefined;
  await assert.rejects(
    readSafeMarkdownFile({
      cwd,
      file: "cancel.md",
      signal: betweenChunks.signal,
      hooks: {
        onOpen: (fd) => (openedFd = fd),
        afterChunk: () => betweenChunks.abort(),
      },
    }),
    /PI_STUDY_INSPECT_CANCELLED/,
  );
  assert.ok(openedFd !== undefined);
  expectClosed(openedFd);
});

test("the safe reader leaves descriptors closed when a test hook fails", async (t) => {
  const { cwd, learningRoot } = createProject(t);
  writeFileSync(join(learningRoot, "hook.md"), "# Hook\n", "utf8");
  let openedFd: number | undefined;

  await assert.rejects(
    readSafeMarkdownFile({
      cwd,
      file: "hook.md",
      hooks: {
        onOpen: (fd) => (openedFd = fd),
        afterOpen: () => {
          throw new Error("controlled hook failure");
        },
      },
    }),
    /PI_STUDY_INSPECT_READ_FAILED file=hook.md/,
  );

  assert.ok(openedFd !== undefined);
  expectClosed(openedFd);
});
