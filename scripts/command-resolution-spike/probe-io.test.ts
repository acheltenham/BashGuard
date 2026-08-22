import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendProbeRecord, loadProbeContext } from "./probe-io.ts";

test("loadProbeContext requires complete isolated environment", () => {
  const complete = {
    BASHGUARD_SPIKE_ROOT: "/tmp/spike",
    BASHGUARD_SPIKE_PROBE_FILE: "/tmp/spike/probe.jsonl",
    BASHGUARD_SPIKE_RUN_ID: "run-1",
    BASHGUARD_SPIKE_SCENARIO: "simple",
    BASHGUARD_SPIKE_EXTENSION_ORDER: '["early","bashguard","late"]',
  };
  assert.deepEqual(loadProbeContext(complete), {
    root: "/tmp/spike",
    probeFile: "/tmp/spike/probe.jsonl",
    runId: "run-1",
    scenario: "simple",
    extensionOrder: ["early", "bashguard", "late"],
  });
  for (const key of Object.keys(complete)) {
    assert.throws(() => loadProbeContext({ ...complete, [key]: undefined }), /Missing command resolution probe environment/);
  }
  assert.throws(() => loadProbeContext({ ...complete, BASHGUARD_SPIKE_PROBE_FILE: "/tmp/outside.jsonl" }), /outside temporary root/);
});

test("appendProbeRecord writes one compact allowlisted JSON object per line", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-probe-io-"));
  const probeFile = join(root, "probe.jsonl");
  const context = loadProbeContext({
    BASHGUARD_SPIKE_ROOT: root,
    BASHGUARD_SPIKE_PROBE_FILE: probeFile,
    BASHGUARD_SPIKE_RUN_ID: "run-1",
    BASHGUARD_SPIKE_SCENARIO: "simple",
    BASHGUARD_SPIKE_EXTENSION_ORDER: '["early"]',
  });

  appendProbeRecord(context, "early_tool_call", { toolCallId: "call-1", command: "echo safe" });
  appendProbeRecord(context, "runtime_fixture", { token: "simple-token", sentinels: { BASHGUARD_SPIKE_MUTATED: "1" } });

  const lines = (await readFile(probeFile, "utf8")).trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]!), {
    runId: "run-1",
    scenario: "simple",
    stage: "early_tool_call",
    extensionOrder: ["early"],
    timestamp: JSON.parse(lines[0]!).timestamp,
    toolCallId: "call-1",
    command: "echo safe",
  });
  assert.throws(
    () => appendProbeRecord(context, "runtime_fixture", { sentinels: { SECRET_TOKEN: "forbidden" } as never }),
    /non-allowlisted sentinel SECRET_TOKEN/,
  );
});
