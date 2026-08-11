import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import registerPiStudyGuard, { GUARD_FLAG } from "../index.ts";

type FlagOptions = Parameters<ExtensionAPI["registerFlag"]>[1];

test("the factory registers the expected marker flag", () => {
  const registrations: Array<{ name: string; options: FlagOptions }> = [];
  const fakeApi: Pick<ExtensionAPI, "registerFlag"> = {
    registerFlag(name, options) {
      registrations.push({ name, options });
    },
  };

  registerPiStudyGuard(fakeApi as ExtensionAPI);

  assert.deepEqual(registrations, [
    {
      name: GUARD_FLAG,
      options: {
        description: "Mark the minimal pi-study-guard extension as loaded",
        type: "boolean",
        default: false,
      },
    },
  ]);
});
