import {
  acquireSessionDirectoryLease,
  ensurePrivateSessionDirectory,
} from "../task-console-runtime.ts";

const sessionDirectory = process.env.PI_STUDY_78_LEASE_DIR;
if (!sessionDirectory) throw new Error("lease fixture directory is required");

try {
  await ensurePrivateSessionDirectory(sessionDirectory);
  const lease = await acquireSessionDirectoryLease(sessionDirectory);
  process.stderr.write("fixture=LEASED\n");
  try {
    await new Promise<void>((resolve) => {
      process.stdin.once("end", resolve);
      process.stdin.resume();
    });
  } finally {
    await lease.release();
  }
  process.stderr.write("fixture=RELEASED\n");
} catch (error) {
  const errorKind = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`fixture=FAILED errorKind=${errorKind}\n`);
  process.exitCode = 1;
}
