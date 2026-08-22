import assert from "node:assert/strict";
import test from "node:test";

import { formatBoundaryReport, NoSandboxAdapter } from "./boundary.ts";

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

test("formatBoundaryReport aligns wide output without overstating absence", async () => {
  const description = await new NoSandboxAdapter().describe();

  const output = formatBoundaryReport(description, 80);

  assert.equal(output, [
    "Boundary",
    "",
    "  Isolation      none detected · unknown",
    "  Mediated       nothing",
    "  Filesystem     no supported restrictions detected",
    "  Network        no supported restrictions detected",
    "",
    "What this means",
    "",
    "  - Without an outer boundary, Pi tools run with the permissions of your user account.",
    "",
    "Not covered by this boundary",
    "",
    "  - any outer container or VM, which BashGuard cannot characterize from inside",
    "  - downstream authority of credentials available to the session",
  ].join("\n"));
  assert.doesNotMatch(output, /\u001b/);
  assert.doesNotMatch(output, /no (?:sandbox|containment boundary) exists/i);
});

test("formatBoundaryReport stacks narrow fields without dropping limitations", async () => {
  const description = await new NoSandboxAdapter().describe();

  const output = formatBoundaryReport(description, 39);

  assert.match(output, /^Boundary\n\nIsolation\n  none detected · unknown/m);
  assert.match(output, /Mediated\n  nothing/);
  assert.match(output, /Filesystem\n  no supported restrictions detected/);
  assert.match(output, /Network\n  no supported restrictions detected/);
  for (const limitation of description.notCovered) assert.match(output, new RegExp(limitation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(output, /\u001b/);
  assert.doesNotMatch(output, /no (?:sandbox|containment boundary) exists/i);
});
