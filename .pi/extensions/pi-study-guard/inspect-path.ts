import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

export const INSPECT_INPUT_MAX_BYTES = 128 * 1024;
const READ_CHUNK_BYTES = 16 * 1024;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,124}\.md$/;

export interface InspectReadHooks {
  onOpen?(fd: number): void;
  afterOpen?(): void | Promise<void>;
  afterChunk?(bytesRead: number): void | Promise<void>;
}

export interface SafeMarkdownReadOptions {
  cwd: string;
  file: string;
  signal?: AbortSignal;
  hooks?: InspectReadHooks;
}

interface RootSnapshot {
  docsDev: bigint;
  docsIno: bigint;
  rootDev: bigint;
  rootIno: bigint;
  root: string;
}

function contractError(code: string, file?: string): Error {
  return new Error(file ? `${code} file=${file}` : code);
}

function isContractError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("PI_STUDY_INSPECT_");
}

export function throwIfInspectCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw contractError("PI_STUDY_INSPECT_CANCELLED");
  }
}

export function validateInspectFileName(file: string): string {
  if (!FILE_PATTERN.test(file)) {
    throw contractError("PI_STUDY_INSPECT_INVALID_FILE");
  }
  return file;
}

async function snapshotRoot(cwd: string): Promise<RootSnapshot> {
  const docs = join(cwd, "docs");
  const root = join(docs, "learning");
  try {
    const [cwdReal, docsStat, rootStat, rootReal] = await Promise.all([
      realpath(cwd),
      lstat(docs, { bigint: true }),
      lstat(root, { bigint: true }),
      realpath(root),
    ]);
    if (
      docsStat.isSymbolicLink() ||
      rootStat.isSymbolicLink() ||
      !docsStat.isDirectory() ||
      !rootStat.isDirectory() ||
      rootReal !== join(cwdReal, "docs", "learning")
    ) {
      throw contractError("PI_STUDY_INSPECT_UNSAFE_ROOT");
    }
    return {
      docsDev: docsStat.dev,
      docsIno: docsStat.ino,
      rootDev: rootStat.dev,
      rootIno: rootStat.ino,
      root,
    };
  } catch (error) {
    if (isContractError(error)) throw error;
    throw contractError("PI_STUDY_INSPECT_ROOT_UNAVAILABLE");
  }
}

async function assertRootUnchanged(cwd: string, before: RootSnapshot): Promise<void> {
  const after = await snapshotRoot(cwd);
  if (
    before.docsDev !== after.docsDev ||
    before.docsIno !== after.docsIno ||
    before.rootDev !== after.rootDev ||
    before.rootIno !== after.rootIno
  ) {
    throw contractError("PI_STUDY_INSPECT_UNSAFE_ROOT");
  }
}

export function sameFileSnapshot(
  before: BigIntStats,
  after: BigIntStats,
): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

function normalizeReadError(error: unknown, file: string, signal?: AbortSignal): Error {
  if (signal?.aborted) return contractError("PI_STUDY_INSPECT_CANCELLED");
  if (isContractError(error)) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return contractError("PI_STUDY_INSPECT_NOT_FOUND", file);
  if (code === "ELOOP") return contractError("PI_STUDY_INSPECT_UNSAFE_FILE", file);
  return contractError("PI_STUDY_INSPECT_READ_FAILED", file);
}

async function openTarget(path: string, file: string): Promise<FileHandle> {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    throw normalizeReadError(error, file);
  }
}

export async function readSafeMarkdownFile(options: SafeMarkdownReadOptions): Promise<string> {
  const file = validateInspectFileName(options.file);
  throwIfInspectCancelled(options.signal);
  const rootBefore = await snapshotRoot(options.cwd);
  throwIfInspectCancelled(options.signal);

  let handle: FileHandle | undefined;
  let content: string | undefined;
  let operationError: unknown;
  try {
    handle = await openTarget(join(rootBefore.root, file), file);
    options.hooks?.onOpen?.(handle.fd);
    throwIfInspectCancelled(options.signal);
    await options.hooks?.afterOpen?.();

    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      throw contractError("PI_STUDY_INSPECT_UNSAFE_FILE", file);
    }
    if (before.size > BigInt(INSPECT_INPUT_MAX_BYTES)) {
      throw contractError("PI_STUDY_INSPECT_INPUT_TOO_LARGE", file);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      throwIfInspectCancelled(options.signal);
      const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > INSPECT_INPUT_MAX_BYTES) {
        throw contractError("PI_STUDY_INSPECT_INPUT_TOO_LARGE", file);
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      await options.hooks?.afterChunk?.(bytesRead);
      throwIfInspectCancelled(options.signal);
    }

    const after = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, after) || BigInt(totalBytes) !== after.size) {
      throw contractError("PI_STUDY_INSPECT_FILE_CHANGED", file);
    }
    await assertRootUnchanged(options.cwd, rootBefore);
    throwIfInspectCancelled(options.signal);
    content = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    operationError = error;
  }

  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      operationError ??= error;
    }
  }

  if (operationError !== undefined) {
    throw normalizeReadError(operationError, file, options.signal);
  }
  return content ?? "";
}
