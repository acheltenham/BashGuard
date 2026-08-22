import assert from "node:assert/strict";
import test from "node:test";

import { NoSandboxAdapter } from "./boundary.ts";

test("NoSandboxAdapter reports only that no supported boundary was detected", async () => {
  const adapter = new NoSandboxAdapter();

  assert.deepEqual(await adapter.describe(), {
    adapterId: "none-detected",
    evidence: "unknown",
    isolation: "none detected",
    mediatedTools: [],
    filesystem: "no supported restrictions detected",
    network: "no supported restrictions detected",
    implications: [
      "Without an outer boundary, Pi tools run with the permissions of your user account.",
    ],
    notCovered: [
      "any outer container or VM, which BashGuard cannot characterize from inside",
      "downstream authority of credentials available to the session",
    ],
  });
  assert.deepEqual(await adapter.observe([]), []);
});
