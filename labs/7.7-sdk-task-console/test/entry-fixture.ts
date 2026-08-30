import { runInteractive } from "../task-console.ts";

const mode = process.env.PI_STUDY_78_FIXTURE_MODE ?? "lines";
const shutdownGraceMs = Number(process.env.PI_STUDY_78_SHUTDOWN_GRACE_MS ?? "5000");

function writeTrace(value: string): void {
  process.stderr.write(`fixture=${value}\n`);
}

let quitCount = 0;
let activeTask = false;

void runInteractive({
  shutdownGraceMs,
  createController: () => ({
    async start(): Promise<void> {
      if (mode === "delayed-start" || mode === "hang-start") {
        writeTrace("STARTING");
        if (mode === "hang-start") {
          process.stdin.resume();
          return new Promise<never>(() => {});
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      writeTrace("READY");
      if (mode === "epipe") {
        const timer = setTimeout(() => {
          process.stdout.write("x".repeat(1024 * 1024));
        }, 25);
        timer.unref();
      }
    },
    async handleLine(line: string): Promise<unknown> {
      if (line !== "/quit") {
        writeTrace(`line:${JSON.stringify(line)}`);
        if (mode === "active-eof") activeTask = true;
        return "STARTED";
      }

      quitCount += 1;
      writeTrace(`quit-start:${quitCount}`);
      if (mode === "hang") return new Promise<never>(() => {});
      if (mode === "shutdown-fail") {
        throw new Error("private shutdown detail must not escape");
      }
      if (mode === "active-eof" && activeTask) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        activeTask = false;
        writeTrace("active-finished");
      }
      writeTrace(`quit-end:${quitCount}`);
      return "QUIT";
    },
  }),
}).catch(() => {
  writeTrace("UNEXPECTED_REJECTION");
  process.exitCode = 99;
});
