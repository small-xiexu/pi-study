import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("scripted runtime ignores disk credentials and still completes its fixed response", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "pi-study-72-auth-"));
  const authPath = path.join(temporaryRoot, "auth.json");
  const fixture = JSON.stringify({
    "pi-study-auth-fixture": { type: "api_key", key: "pi-study-fake-credential" },
  });
  try {
    await writeFile(authPath, fixture, { mode: 0o600 });
    // Start a fresh process so SDK imports cannot capture the real HOME or agent directory.
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { ModelRuntime } from "@earendil-works/pi-coding-agent";
      import { createScriptedRuntime, textStream } from "./test-runtime.ts";

      const control = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
      assert.deepEqual(await control.listCredentials(), [
        { providerId: "pi-study-auth-fixture", type: "api_key" },
      ]);

      const { modelRuntime, model, getAttemptCount } = await createScriptedRuntime(
        selected => textStream(selected, "ISOLATED_RUNTIME_OK"),
      );
      assert.equal((await modelRuntime.listCredentials()).length, 0);
      const result = await modelRuntime.completeSimple(model, {
        messages: [{ role: "user", content: "Return the fixed response", timestamp: Date.now() }],
      });
      assert.equal(result.stopReason, "stop");
      assert.deepEqual(result.content, [{ type: "text", text: "ISOLATED_RUNTIME_OK" }]);
      assert.equal(getAttemptCount(), 1);
      assert.equal((await modelRuntime.listCredentials()).length, 0);
    `], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        PATH: path.dirname(process.execPath),
        HOME: temporaryRoot,
        PI_CODING_AGENT_DIR: temporaryRoot,
        PI_OFFLINE: "1",
        PI_TELEMETRY: "0",
      },
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(await readFile(authPath, "utf8"), fixture);
    assert.deepEqual(await readdir(temporaryRoot), ["auth.json"]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
