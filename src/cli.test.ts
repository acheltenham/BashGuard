import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { buildAttachStatus, buildDebrief, chooseSession, classifyCommandRisk, discoverSessions, eligibleSessionChoices, filterEvidenceEvents, findEvent, formatActivityList, formatAttachGuidance, formatAttachStatus, formatDebrief, formatDoctorReport, formatEventInspection, formatFilteredEvents, formatInspectableEvents, formatSessionList, formatTimelineEvent, indexSessionChoices, installLocalCliShim, normalizeEvent, parseCommandArgs, parseJsonlEvents, parsePiListPackages, renderEvent, resolveSessionChoice, selectAttachHistory, selectSessionForCommand, selectSessionForCommandResult, type SessionChoice, type SessionSummary } from "./cli.ts";

async function writeSession(root: string, sessionId: string, events: Array<Record<string, unknown>>, processId = 999_999): Promise<void> {
  const directory = join(root, sessionId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "session.json"),
    `${JSON.stringify({ schemaVersion: 1, sessionId, repository: "repo", cwd: "/tmp/repo", processId })}\n`,
  );
  await writeFile(join(directory, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function event(sequence: number, type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: `evt-${sequence}`,
    sequence,
    timestamp: "2026-08-03T12:00:00.000Z",
    type,
    sessionId: "session-a",
    payload: {},
    ...extra,
  };
}

test("parseJsonlEvents skips malformed complete lines and incomplete final lines", () => {
  const parsed = parseJsonlEvents(`${JSON.stringify(event(2, "agent.ended"))}\nnot-json\n{`);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.sequence, 2);
});

test("discoverSessions excludes metadata session IDs containing NUL while retaining valid neighbors", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "valid-neighbor", [event(1, "session.started")]);
  const malformedDirectory = join(root, "malformed-metadata");
  await mkdir(malformedDirectory, { recursive: true });
  await writeFile(
    join(malformedDirectory, "session.json"),
    `${JSON.stringify({ schemaVersion: 1, sessionId: "malformed\u0000session", processId: 999_999 })}\n`,
  );
  await writeFile(join(malformedDirectory, "events.jsonl"), `${JSON.stringify(event(1, "session.started"))}\n`);

  const sessions = await discoverSessions(root);

  assert.deepEqual(sessions.map((session) => session.metadata.sessionId), ["valid-neighbor"]);
});

test("discoverSessions normalizes malformed optional metadata while retaining the selectable session", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "valid-neighbor", [event(1, "session.started")]);
  await writeSession(root, "malformed-optionals", [event(1, "session.shutdown")]);
  await writeFile(join(root, "malformed-optionals", "session.json"), `${JSON.stringify({
    schemaVersion: 1,
    sessionId: "malformed-optionals",
    cwd: { forged: "cwd" },
    repository: 42,
    name: ["forged-name"],
    title: false,
    sessionName: {},
    startedAt: [],
    processId: "123",
    piMode: 7,
    recorderSource: { forged: true },
  })}\n`);

  const sessions = await discoverSessions(root);
  const malformed = sessions.find((session) => session.metadata.sessionId === "malformed-optionals");

  assert.equal(sessions.length, 2);
  assert.deepEqual(malformed?.metadata, { schemaVersion: 1, sessionId: "malformed-optionals" });
  assert.doesNotThrow(() => formatSessionList(sessions));
  assert.match(formatSessionList(sessions), /malforme\s+-\s+unknown/);
  assert.equal(resolveSessionChoice("malformed", indexSessionChoices(sessions))?.session, malformed);
});

test("discoverSessions excludes every session with a duplicate metadata ID while retaining valid neighbors", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "duplicate-directory-a", [event(1, "session.started")]);
  await writeSession(root, "duplicate-directory-b", [event(1, "session.started")]);
  await writeSession(root, "valid-neighbor", [event(1, "session.started")]);
  for (const directory of ["duplicate-directory-a", "duplicate-directory-b"]) {
    await writeFile(join(root, directory, "session.json"), `${JSON.stringify({ schemaVersion: 1, sessionId: "duplicate-metadata-id", processId: 999_999 })}\n`);
  }

  const sessions = await discoverSessions(root);

  assert.deepEqual(sessions.map((session) => session.metadata.sessionId), ["valid-neighbor"]);
});

test("discoverSessions treats a restart after an older shutdown as active when the current pid is alive", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "session-a", [
    event(1, "session.started", { id: "old-start" }),
    event(2, "session.shutdown", { id: "old-shutdown" }),
    event(1, "session.started", { id: "new-start" }),
  ], process.pid);

  const sessions = await discoverSessions(root);

  assert.equal(sessions[0]?.active, true);
});

test("discoverSessions recognizes newer metadata while the restarted session-start event is pending", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "session-a", [
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "session.shutdown", { timestamp: "2026-08-03T12:01:00.000Z" }),
  ], process.pid);
  const metadataPath = join(root, "session-a", "session.json");
  await writeFile(metadataPath, `${JSON.stringify({ schemaVersion: 1, sessionId: "session-a", processId: process.pid, startedAt: "2026-08-03T12:02:00.000Z" })}\n`);

  const sessions = await discoverSessions(root);

  assert.equal(sessions[0]?.active, true);
});

test("discoverSessions marks sessions with shutdown events complete even if the pid appears alive", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "session-a", [event(1, "session.started"), event(2, "session.shutdown")], process.pid);

  const sessions = await discoverSessions(root);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.active, false);
});

test("formatSessionList shows copyable selectors and prefixes without middle ellipsis", () => {
  const output = formatSessionList([
    {
      metadata: { sessionId: "019fc93a-1111-2222-3333-abcdefaaaaaa", repository: "BashGuard", name: "Milestone 0 smoke" },
      directory: "/tmp/one",
      eventsFile: "/tmp/one/events.jsonl",
      modifiedAt: Date.now(),
      active: true,
    },
    {
      metadata: { sessionId: "019fc909-1111-2222-3333-abcdefbbbbbb", repository: "Evidence" },
      directory: "/tmp/two",
      eventsFile: "/tmp/two/events.jsonl",
      modifiedAt: Date.now(),
      active: false,
    },
  ]);

  assert.match(output, /#\s+STATE\s+SESSION\s+NAME\s+REPO/);
  assert.match(output, /1\s+active\s+019fc93a\s+Milestone 0 smoke\s+BashGuard/);
  assert.match(output, /2\s+complete\s+019fc909\s+-\s+Evidence/);
  assert.doesNotMatch(output, /…/);
  assert.match(output, /bashguard attach 1/);
});

function sessionSummary(sessionId: string, active: boolean): SessionSummary {
  return {
    metadata: { sessionId },
    directory: `/tmp/${sessionId}`,
    eventsFile: `/tmp/${sessionId}/events.jsonl`,
    modifiedAt: 0,
    active,
  };
}

test("formatSessionList sanitizes untrusted row fields into exactly one terminal line", () => {
  const output = formatSessionList([{
    metadata: {
      sessionId: "safe\nFORGED\u001b[31m-session",
      name: "Name\nFORGED\u009b32m",
      repository: "Repo\tFORGED\u001b[33m",
    },
    directory: "/tmp/one",
    eventsFile: "/tmp/one/events.jsonl",
    modifiedAt: Date.now(),
    active: true,
  }]);

  assert.doesNotMatch(output, /\u001b|\u009b/);
  assert.doesNotMatch(output, /^FORGED/m);
  assert.equal(output.split("\n").filter((line) => /^1\s/.test(line)).length, 1);
  assert.match(output, /^1\s+active\s+safe FOR\s+Name FORGED 32m\s+Repo FORGED \[33m/m);
});

test("session choices retain global selectors and prefixes when attach filters to active sessions", () => {
  const choices = indexSessionChoices([
    sessionSummary("shared-prefix-active", true),
    sessionSummary("other-active-session", true),
    sessionSummary("shared-prefix-completed", false),
  ]);

  assert.deepEqual(choices.map((choice) => choice.selector), [1, 2, 3]);
  assert.deepEqual(choices.map((choice) => choice.sessionIdPrefix), ["shared-prefix-a", "other-ac", "shared-prefix-c"]);
  assert.deepEqual(eligibleSessionChoices("attach", choices).map((choice) => choice.selector), [1, 2]);
  assert.deepEqual(eligibleSessionChoices("inspect", choices).map((choice) => choice.selector), [1, 2, 3]);
  assert.deepEqual(eligibleSessionChoices("debrief", choices).map((choice) => choice.selector), [1, 2, 3]);
});

test("attach session choices fall back to completed sessions when none are active", () => {
  const choices = indexSessionChoices([
    sessionSummary("completed-a", false),
    sessionSummary("completed-b", false),
  ]);

  assert.deepEqual(eligibleSessionChoices("attach", choices), choices);
});

test("resolveSessionChoice supports global indexes, exact IDs, and unique prefixes", () => {
  const choices = indexSessionChoices([
    sessionSummary("completed-session", false),
    sessionSummary("active-alpha", true),
    sessionSummary("active-beta", true),
  ]);

  assert.equal(resolveSessionChoice("1", choices)?.session.metadata.sessionId, "completed-session");
  assert.equal(resolveSessionChoice("active-beta", choices)?.selector, 3);
  assert.equal(resolveSessionChoice("active-al", choices)?.selector, 2);
  assert.equal(resolveSessionChoice("missing", choices), undefined);
});

test("resolveSessionChoice prefers an exact numeric ID before a row index", () => {
  const choices = indexSessionChoices([
    sessionSummary("other-session", false),
    sessionSummary("1", false),
    sessionSummary("2-prefix-target", false),
    sessionSummary("1-prefix-target", false),
  ]);

  assert.equal(resolveSessionChoice("1", choices)?.session.metadata.sessionId, "1");
  assert.equal(resolveSessionChoice("2", choices)?.session.metadata.sessionId, "1");
});

test("indexSessionChoices expands a numeric-looking unique prefix that would resolve as another row", () => {
  const choices = indexSessionChoices([
    sessionSummary("00000002-target", false),
    sessionSummary("other-session", false),
  ]);

  assert.equal(choices[0]?.sessionIdPrefix, "00000002-");
  assert.equal(resolveSessionChoice(choices[0]!.sessionIdPrefix, choices), choices[0]);
});

test("resolveSessionChoice rejects ambiguous prefixes", () => {
  const choices = indexSessionChoices([
    sessionSummary("active-alpha", true),
    sessionSummary("active-beta", true),
    sessionSummary("99-alpha", false),
    sessionSummary("99-beta", false),
  ]);

  assert.throws(() => resolveSessionChoice("active-", choices), /Session prefix active- is ambiguous/);
  assert.throws(() => resolveSessionChoice("99", choices), /Session prefix 99 is ambiguous/);
});

test("resolveSessionChoice recognizes only canonical positive decimal row indexes", () => {
  const choices = indexSessionChoices([
    sessionSummary("canonical-row-one", false),
    sessionSummary("+1-target", false),
    sessionSummary("01-target", false),
    sessionSummary("1e3-target", false),
    sessionSummary("1e000000-target", false),
  ]);
  choices.push({ ...choices[0]!, selector: 1000 });

  assert.equal(resolveSessionChoice("1", choices)?.session.metadata.sessionId, "canonical-row-one");
  assert.equal(resolveSessionChoice("+1", choices)?.session.metadata.sessionId, "+1-target");
  assert.equal(resolveSessionChoice("01", choices)?.session.metadata.sessionId, "01-target");
  assert.equal(resolveSessionChoice("1e3", choices)?.session.metadata.sessionId, "1e3-target");
  assert.equal(resolveSessionChoice("1e000000-target", choices)?.session.metadata.sessionId, "1e000000-target");
});

function selectionStreams(inputIsTTY: boolean | undefined, outputIsTTY: boolean | undefined): {
  input: PassThrough & { isTTY?: boolean };
  output: PassThrough & { isTTY?: boolean };
} {
  const input = Object.assign(new PassThrough(), { isTTY: inputIsTTY });
  const output = Object.assign(new PassThrough(), { isTTY: outputIsTTY });
  return { input, output };
}

test("selectSessionForCommand fails with the existing no-sessions error", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));

  await assert.rejects(
    () => selectSessionForCommand("inspect", undefined, { root }),
    new Error(`No BashGuard sessions found in ${root}`),
  );
});

test("selectSessionForCommand resolves explicit selectors against all sessions without prompting", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "completed-session", [event(1, "session.shutdown")]);
  await writeSession(root, "active-alpha", [event(1, "session.started")], process.pid);
  await writeSession(root, "active-beta", [event(1, "session.started")], process.pid);
  let promptCalls = 0;

  const selected = await selectSessionForCommand("attach", "completed", {
    root,
    ...selectionStreams(false, false),
    prompt: async () => {
      promptCalls += 1;
      throw new Error("prompt should not run");
    },
  });

  assert.equal(selected.metadata.sessionId, "completed-session");
  assert.equal(promptCalls, 0);
});

test("selectSessionForCommand preserves explicit not-found and ambiguous-prefix behavior", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "shared-alpha", [event(1, "session.shutdown")]);
  await writeSession(root, "shared-beta", [event(1, "session.shutdown")]);

  await assert.rejects(
    () => selectSessionForCommand("inspect", "shared-", { root }),
    /Session prefix shared- is ambiguous/,
  );
  await assert.rejects(
    () => selectSessionForCommand("inspect", "0", { root }),
    /Session 0 was not found/,
  );
  await assert.rejects(
    () => selectSessionForCommand("inspect", "-1", { root }),
    /Session -1 was not found/,
  );
  await assert.rejects(
    () => selectSessionForCommand("inspect", "3", { root }),
    /Session 3 was not found/,
  );
});

for (const command of ["inspect", "debrief"] as const) {
  test(`${command} not-found guidance describes recorded sessions and gives a matching command`, async () => {
    const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
    await writeSession(root, "recorded-session", [event(1, "session.shutdown")]);

    await assert.rejects(
      () => selectSessionForCommand(command, "missing-session", { root }),
      (error: Error) => {
        assert.match(error.message, new RegExp(`^Session missing-session was not found in ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
        assert.match(error.message, /sessions recorded while the BashGuard extension was loaded/);
        assert.match(error.message, new RegExp(`^  bashguard ${command} 1$`, "m"));
        return true;
      },
    );
  });
}

test("selectSessionForCommand resolves zero, negative, and out-of-range numeric-looking IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "0", [event(1, "session.shutdown")]);
  await writeSession(root, "-1-session", [event(1, "session.shutdown")]);
  await writeSession(root, "99-session", [event(1, "session.shutdown")]);

  assert.equal((await selectSessionForCommand("inspect", "0", { root })).metadata.sessionId, "0");
  assert.equal((await selectSessionForCommand("inspect", "-1", { root })).metadata.sessionId, "-1-session");
  assert.equal((await selectSessionForCommand("inspect", "99", { root })).metadata.sessionId, "99-session");
});

test("selectSessionForCommand auto-selects one eligible active session without prompting", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "completed-session", [event(1, "session.shutdown")]);
  await writeSession(root, "only-active-session", [event(1, "session.started")], process.pid);

  const selected = await selectSessionForCommand("attach", undefined, {
    root,
    prompt: async () => {
      throw new Error("prompt should not run");
    },
  });

  assert.equal(selected.metadata.sessionId, "only-active-session");
});

test("selectSessionForCommand prompts for only active attach choices with global selectors", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "completed-session", [event(1, "session.shutdown")]);
  await writeSession(root, "active-alpha", [event(1, "session.started")], process.pid);
  await writeSession(root, "active-beta", [event(1, "session.started")], process.pid);
  const snapshot = await discoverSessions(root);
  const expected = eligibleSessionChoices("attach", indexSessionChoices(snapshot));
  let prompted: readonly SessionChoice[] | undefined;

  const selected = await selectSessionForCommand("attach", undefined, {
    root,
    ...selectionStreams(true, true),
    prompt: async (choices) => {
      prompted = choices;
      return choices[1]!;
    },
  });

  assert.deepEqual(prompted?.map((choice) => choice.selector), expected.map((choice) => choice.selector));
  assert.ok(prompted?.every((choice) => choice.session.active));
  assert.equal(selected, prompted?.[1]?.session);
});

test("selectSessionForCommand uses all completed attach choices when none are active", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "completed-alpha", [event(1, "session.shutdown")]);
  await writeSession(root, "completed-beta", [event(1, "session.shutdown")]);
  let prompted: readonly SessionChoice[] | undefined;

  await selectSessionForCommand("attach", undefined, {
    root,
    ...selectionStreams(true, true),
    prompt: async (choices) => {
      prompted = choices;
      return choices[0]!;
    },
  });

  assert.equal(prompted?.length, 2);
  assert.ok(prompted?.every((choice) => !choice.session.active));
});

for (const command of ["inspect", "debrief"] as const) {
  test(`selectSessionForCommand passes all sessions to the ${command} prompt`, async () => {
    const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
    await writeSession(root, "completed-session", [event(1, "session.shutdown")]);
    await writeSession(root, "active-session", [event(1, "session.started")], process.pid);
    let prompted: readonly SessionChoice[] | undefined;

    await selectSessionForCommand(command, undefined, {
      root,
      ...selectionStreams(true, true),
      prompt: async (choices) => {
        prompted = choices;
        return choices[0]!;
      },
    });

    assert.equal(prompted?.length, 2);
    assert.deepEqual(prompted?.map((choice) => choice.session.active).sort(), [false, true]);
  });
}

for (const [inputIsTTY, outputIsTTY] of [[false, true], [true, false], [undefined, true]] as const) {
  test(`non-interactive session selection rejects for TTY pair ${inputIsTTY}/${outputIsTTY}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
    await writeSession(root, "completed-alpha", [event(1, "session.shutdown")]);
    await writeSession(root, "completed-beta", [event(1, "session.shutdown")]);
    const sessions = await discoverSessions(root);
    const choices = indexSessionChoices(sessions);
    let promptCalls = 0;

    await assert.rejects(
      () => selectSessionForCommand("debrief", undefined, {
        root,
        ...selectionStreams(inputIsTTY, outputIsTTY),
        prompt: async () => {
          promptCalls += 1;
          throw new Error("prompt should not run");
        },
      }),
      (error: Error) => {
        assert.match(error.message, /More than one eligible session exists for `bashguard debrief`\./);
        for (const choice of choices) {
          assert.match(error.message, new RegExp(`^${choice.selector}\\s+`, "m"));
          assert.match(error.message, new RegExp(`bashguard debrief --session-id=${choice.session.metadata.sessionId}`));
          assert.doesNotMatch(error.message, new RegExp(`bashguard debrief --session=${choice.sessionIdPrefix}`));
        }
        assert.match(error.message, /completed-/);
        return true;
      },
    );
    assert.equal(promptCalls, 0);
  });
}

test("selectSessionForCommand returns the exact session object from its prompt snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "snapshot-alpha", [event(1, "session.shutdown")]);
  await writeSession(root, "snapshot-beta", [event(1, "session.shutdown")]);
  let promptedChoice: SessionChoice | undefined;

  const selected = await selectSessionForCommand("inspect", undefined, {
    root,
    ...selectionStreams(true, true),
    prompt: async (choices) => {
      promptedChoice = choices[0];
      await writeSession(root, "later-session", [event(1, "session.shutdown")]);
      return promptedChoice!;
    },
  });

  assert.equal(selected, promptedChoice?.session);
  assert.notEqual(selected.metadata.sessionId, "later-session");
});

test("selectSessionForCommand discovers once and prompts from that snapshot", async () => {
  const firstSnapshot = [sessionSummary("first-alpha", false), sessionSummary("first-beta", false)];
  const hypotheticalSecondSnapshot = [sessionSummary("later-alpha", false), sessionSummary("later-beta", false)];
  let discoveryCalls = 0;
  let promptedIds: string[] = [];

  const selected = await selectSessionForCommand("inspect", undefined, {
    ...selectionStreams(true, true),
    discoverSessions: async () => {
      discoveryCalls += 1;
      return discoveryCalls === 1 ? firstSnapshot : hypotheticalSecondSnapshot;
    },
    prompt: async (choices) => {
      promptedIds = choices.map((choice) => choice.session.metadata.sessionId);
      return choices[1]!;
    },
  });

  assert.equal(discoveryCalls, 1);
  assert.deepEqual(promptedIds, ["first-alpha", "first-beta"]);
  assert.equal(selected, firstSnapshot[1]);
});

for (const command of ["inspect", "debrief", "attach"] as const) {
  test(`selector-less ${command} derives its shortest unique session prefix from one snapshot`, async () => {
    const snapshot = [
      sessionSummary("019fc93a-1111-aaaa", command === "attach"),
      sessionSummary("019fc93a-2222-bbbb", command === "attach"),
    ];
    let discoveryCalls = 0;

    const result = await selectSessionForCommandResult(command, undefined, {
      ...selectionStreams(true, true),
      discoverSessions: async () => {
        discoveryCalls += 1;
        return snapshot;
      },
      prompt: async (choices) => choices[0]!,
    });

    assert.equal(discoveryCalls, 1);
    assert.equal(result.session, snapshot[0]);
    assert.equal(result.selector, "019fc93a-1");
    assert.notEqual(result.selector, result.session.metadata.sessionId);
  });
}

test("explicit session selection preserves the requested selector", async () => {
  const snapshot = [sessionSummary("019fc93a-1111-aaaa", false), sessionSummary("019fc93a-2222-bbbb", false)];

  const result = await selectSessionForCommandResult("debrief", "019fc93a-2", {
    discoverSessions: async () => snapshot,
  });

  assert.equal(result.session, snapshot[1]);
  assert.equal(result.selector, "019fc93a-2");
});

test("exact session selection matches only the full metadata ID and bypasses prompting", async () => {
  const snapshot = [sessionSummary("1", false), sessionSummary("1-future", false)];
  let promptCalls = 0;

  const result = await selectSessionForCommandResult("inspect", undefined, {
    exactSessionId: "1",
    discoverSessions: async () => snapshot,
    prompt: async () => {
      promptCalls += 1;
      throw new Error("prompt should not run");
    },
  });

  assert.equal(result.session, snapshot[0]);
  assert.equal(result.selector, "--session-id=1");
  assert.equal(promptCalls, 0);
  await assert.rejects(
    () => selectSessionForCommandResult("inspect", undefined, {
      exactSessionId: "1-",
      discoverSessions: async () => snapshot,
    }),
    /Session 1- was not found/,
  );
});

test("chooseSession accepts session list index selectors", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "session-a", [event(1, "session.started"), event(2, "session.shutdown")]);
  await writeSession(root, "session-b", [event(1, "session.started"), event(2, "session.shutdown")]);

  const sessions = await discoverSessions(root);
  const selected = await chooseSession("2", root);

  assert.equal(selected.metadata.sessionId, sessions[1]?.metadata.sessionId);
});

test("chooseSession preserves exact ID, unique-prefix, and ambiguous-prefix compatibility", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "shared-alpha", [event(1, "session.shutdown")]);
  await writeSession(root, "shared-beta", [event(1, "session.shutdown")]);

  assert.equal((await chooseSession("shared-alpha", root)).metadata.sessionId, "shared-alpha");
  assert.equal((await chooseSession("shared-b", root)).metadata.sessionId, "shared-beta");
  await assert.rejects(() => chooseSession("shared-", root), /Session prefix shared- is ambiguous/);
});

test("chooseSession not-found errors explain BashGuard recorded-session scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "session-a", [event(1, "session.started"), event(2, "session.shutdown")]);

  await assert.rejects(
    () => chooseSession("missing-session", root),
    /BashGuard can only attach to sessions recorded while the BashGuard extension was loaded\./,
  );
});

test("parseCommandArgs accepts positional, snapshot, and exact session selectors", () => {
  assert.deepEqual(parseCommandArgs(["sessions"]), { command: "sessions" });
  assert.deepEqual(parseCommandArgs(["sessions", "list"]), { command: "sessions" });
  assert.deepEqual(parseCommandArgs(["session", "list"]), { command: "sessions" });
  assert.deepEqual(parseCommandArgs(["attach", "1"]), { command: "attach", sessionId: "1" });
  assert.deepEqual(parseCommandArgs(["attach", "--session", "1"]), { command: "attach", sessionId: "1" });
  for (const command of ["attach", "inspect", "debrief"]) {
    assert.deepEqual(parseCommandArgs([command, "--session-id", "exact value"]), { command, exactSessionId: "exact value" });
    for (const exactId of ["--foo", "list", "events", " spaced\tselector\n", "1"]) {
      assert.deepEqual(parseCommandArgs([command, `--session-id=${exactId}`]), { command, exactSessionId: exactId });
    }
    for (const selector of ["--foo", "list", "events", " spaced\tselector\n"]) {
      assert.deepEqual(parseCommandArgs([command, `--session=${selector}`]), { command, sessionId: selector });
    }
  }
  assert.deepEqual(parseCommandArgs(["attach", "1", "--history", "100"]), { command: "attach", sessionId: "1", attachHistory: 100 });
  assert.deepEqual(parseCommandArgs(["attach", "1", "--history", "0"]), { command: "attach", sessionId: "1", attachHistory: 0 });
  assert.deepEqual(parseCommandArgs(["attach", "1", "--all-history"]), { command: "attach", sessionId: "1", allHistory: true });
  assert.deepEqual(parseCommandArgs(["inspect", "--session", "1", "--event", "evt-1"]), { command: "inspect", sessionId: "1", eventId: "evt-1" });
  assert.deepEqual(parseCommandArgs(["inspect", "1", "list", "events"]), { command: "inspect", sessionId: "1" });
  assert.deepEqual(parseCommandArgs(["inspect", "1", "--activity", "shell", "--activity", "risk", "--type", "capture.gap", "--grep", "deploy", "--limit", "200", "--format", "jsonl"]), {
    command: "inspect",
    sessionId: "1",
    activities: ["shell", "risk"],
    eventTypes: ["capture.gap"],
    grep: "deploy",
    limit: 200,
    format: "jsonl",
  });
  assert.deepEqual(parseCommandArgs(["inspect", "1", "--activity", "shell", "--all"]), { command: "inspect", sessionId: "1", activities: ["shell"], all: true });
  assert.deepEqual(parseCommandArgs(["debrief", "--session", "1"]), { command: "debrief", sessionId: "1" });
  assert.deepEqual(parseCommandArgs(["setup", "cli", "--global"]), { command: "setup", setupSubject: "cli", setupScope: "global" });
  assert.deepEqual(parseCommandArgs(["setup", "cli", "--local"]), { command: "setup", setupSubject: "cli", setupScope: "local" });
  assert.deepEqual(parseCommandArgs(["doctor"]), { command: "doctor" });
});

test("parseCommandArgs rejects missing filter values and unknown options", () => {
  for (const command of ["attach", "inspect", "debrief"]) {
    assert.throws(() => parseCommandArgs([command, "--session"]), new Error("`--session` requires a value"));
    assert.throws(() => parseCommandArgs([command, "--session", "--activity"]), new Error("`--session` requires a value"));
    assert.throws(() => parseCommandArgs([command, "--session="]), new Error("`--session` requires a value"));
    assert.throws(() => parseCommandArgs([command, "--session-id"]), new Error("--session-id requires a value"));
    assert.throws(() => parseCommandArgs([command, "--session-id", "--activity"]), new Error("--session-id requires a value"));
    assert.throws(() => parseCommandArgs([command, "--session-id="]), new Error("--session-id requires a value"));
    assert.throws(() => parseCommandArgs([command, "positional", "--session-id=exact"]), /cannot combine --session-id with a positional or --session selector/);
    assert.throws(() => parseCommandArgs([command, "--session=prefix", "--session-id=exact"]), /cannot combine --session-id with a positional or --session selector/);
    assert.throws(() => parseCommandArgs([command, "--session-id=exact", "positional"]), /cannot combine --session-id with a positional or --session selector/);
  }
  assert.throws(() => parseCommandArgs(["inspect", "--event"]), new Error("`--event` requires a value"));
  assert.throws(() => parseCommandArgs(["inspect", "--event", "--all"]), new Error("`--event` requires a value"));
  assert.throws(() => parseCommandArgs(["inspect", "1", "--activity"]), /`--activity` requires a value/);
  assert.throws(() => parseCommandArgs(["inspect", "1", "--grep"]), /`--grep` requires a value/);
  assert.throws(() => parseCommandArgs(["inspect", "1", "--unknown"]), /Unknown option: --unknown/);
  assert.throws(() => parseCommandArgs(["attach", "1", "--history"]), /`--history` requires a value/);
  assert.throws(() => parseCommandArgs(["inspect", "1", "--history", "2"]), /attach history options can only be used with `bashguard attach`/);
});

test("parsePiListPackages keeps configured sources and ignores resolved checkout paths", () => {
  const packages = parsePiListPackages(`User packages:\n  git:github.com/acheltenham/BashGuard\n    /Users/example/.pi/agent/git/github.com/acheltenham/BashGuard\nProject packages:\n  /Users/example/Development/BashGuard\n`);

  assert.deepEqual(packages, ["git:github.com/acheltenham/BashGuard", "/Users/example/Development/BashGuard"]);
});

test("formatDoctorReport summarizes CLI, session store, Pi package, and next steps", () => {
  const output = formatDoctorReport({
    cliCommand: "/tmp/bashguard/bin/bashguard",
    packageRoot: "/tmp/bashguard",
    dataRoot: "/tmp/bashguard-data",
    globalCommandPath: "/usr/local/bin/bashguard",
    sessions: [
      {
        metadata: { sessionId: "session-a", repository: "Demo", name: "Doctor smoke" },
        directory: "/tmp/bashguard-data/session-a",
        eventsFile: "/tmp/bashguard-data/session-a/events.jsonl",
        modifiedAt: Date.now(),
        active: true,
      },
    ],
    piListAvailable: true,
    piPackages: ["git:github.com/acheltenham/BashGuard", "git:github.com/coctostan/pi-superpowers"],
  });

  assert.match(output, /BashGuard doctor/);
  assert.match(output, /Command\s+\/tmp\/bashguard\/bin\/bashguard/);
  assert.match(output, /Global command\s+\/usr\/local\/bin\/bashguard/);
  assert.match(output, /Data dir\s+\/tmp\/bashguard-data/);
  assert.match(output, /Sessions found\s+1/);
  assert.match(output, /Latest session\s+1 · active · Doctor smoke · Demo/);
  assert.match(output, /Installed\s+yes/);
  assert.match(output, /Source\s+git:github\.com\/acheltenham\/BashGuard/);
  assert.match(output, /Update\s+pi update git:github\.com\/acheltenham\/BashGuard/);
  assert.match(output, /- bashguard sessions/);
});

test("formatDoctorReport warns about multiple configured BashGuard package sources", () => {
  const output = formatDoctorReport({
    cliCommand: "/tmp/bashguard/bin/bashguard",
    packageRoot: "/tmp/bashguard",
    dataRoot: "/tmp/bashguard-data",
    sessions: [],
    piListAvailable: true,
    piPackages: [
      "git:github.com/acheltenham/BashGuard",
      "/tmp/local/BashGuard",
      "git:github.com/coctostan/pi-superpowers",
    ],
  });

  assert.match(output, /Configured sources\s+2/);
  assert.match(output, /Configuration warning\s+multiple BashGuard package sources found/);
  assert.match(output, /This does not prove both sources are active in a running Pi session/);
  assert.match(output, /- Review `pi list` and remove the redundant BashGuard source/);
});

test("formatDoctorReport explains missing Pi package and CLI setup", () => {
  const output = formatDoctorReport({
    cliCommand: "/tmp/bashguard/bin/bashguard",
    packageRoot: "/tmp/bashguard",
    dataRoot: "/tmp/bashguard-data",
    sessions: [],
    piListAvailable: true,
    piPackages: ["git:github.com/coctostan/pi-superpowers"],
  });

  assert.match(output, /Global command\s+not found/);
  assert.match(output, /Installed\s+no/);
  assert.match(output, /- pi install git:github\.com\/acheltenham\/BashGuard/);
  assert.match(output, /- \/tmp\/bashguard\/bin\/bashguard setup cli --global/);
});

test("installLocalCliShim creates a project-local bashguard wrapper", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-local-shim-test-"));
  const shim = await installLocalCliShim(root, "/opt/bashguard/bin/bashguard");
  const content = await readFile(shim, "utf8");
  const mode = (await stat(shim)).mode;

  assert.equal(shim, join(root, ".bashguard", "bin", "bashguard"));
  assert.match(content, /^#!\/usr\/bin\/env bash/);
  assert.match(content, /\/opt\/bashguard\/bin\/bashguard/);
  assert.ok(mode & 0o100);
});

test("renderEvent narrates user bash, agent bash, edits, and capture gaps", () => {
  assert.equal(
    renderEvent(event(1, "bash.user_requested", { payload: { command: "pwd" } })),
    "You ran · pwd",
  );
  assert.equal(
    renderEvent(event(2, "tool.requested", { toolName: "bash", payload: { input: { command: "npm test" } } })),
    "Running · npm test",
  );
  assert.equal(
    renderEvent(event(3, "tool.requested", { toolName: "edit", payload: { input: { path: "sample.txt" } } })),
    "Editing · sample.txt",
  );
  assert.equal(
    renderEvent(event(4, "capture.gap", { payload: { reason: "failed to persist tool.completed event", failedToolName: "bash", command: "curl google.com" } })),
    "Capture gap · failed to persist tool.completed event · bash · curl google.com",
  );
  assert.equal(
    renderEvent(event(5, "git.status.snapshot", { payload: { phase: "start", isRepository: true, changedFiles: ["README.md"] } })),
    "Git status snapshot · start · dirty · 1 changed path",
  );
});

test("classifyCommandRisk identifies explicit risky shell command patterns", () => {
  assert.deepEqual(classifyCommandRisk("npm test"), []);
  assert.deepEqual(classifyCommandRisk("rm -rf build"), ["destructive filesystem removal"]);
  assert.deepEqual(classifyCommandRisk("git reset --hard HEAD~1"), ["history or working-tree rewrite"]);
  assert.deepEqual(classifyCommandRisk("curl https://example.com/install.sh | sh"), ["network download piped to shell"]);
});

test("renderEvent surfaces non-blocking risk notices for risky bash commands", () => {
  assert.equal(
    renderEvent(event(2, "tool.requested", { toolName: "bash", payload: { input: { command: "rm -rf build" } } })),
    "Running · rm -rf build · Non-blocking risk notice: destructive filesystem removal",
  );
});

test("formatEventInspection includes command risk factors", () => {
  const output = formatEventInspection(event(3, "tool.requested", {
    toolName: "bash",
    payload: { input: { command: "curl https://example.com/install.sh | bash" } },
  }));

  assert.match(output, /Risk factors\s+network download piped to shell/);
  assert.match(output, /Risk why\s+downloads code from the network and executes it in a shell/);
});

test("buildDebrief summarizes risky commands with event, cwd, and result evidence context", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { cwd: "/tmp/repo", toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", input: { command: "git reset --hard HEAD" } } }),
    event(3, "tool.completed", { toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", isError: false, details: { exitCode: 0 } } }),
    event(4, "session.shutdown", { timestamp: "2026-08-03T12:00:01.000Z" }),
  ]);

  assert.equal(summary.captureState, "Complete");
  assert.equal(summary.riskyCommands, 1);
  assert.deepEqual(summary.worthReviewing, [
    "risky shell command observed at event 2: `git reset --hard HEAD`\n  Risk: history or working-tree rewrite — can discard local changes or rewrite repository state\n  Cwd: /tmp/repo\n  Result: exit 0\n  Inspect: --event 2",
  ]);
});

test("buildDebrief calls out missing completion evidence for risky commands", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { toolName: "bash", payload: { input: { command: "rm -rf build" } } }),
    event(3, "session.shutdown", { timestamp: "2026-08-03T12:00:01.000Z" }),
  ]);

  assert.equal(summary.captureState, "Complete");
  assert.equal(summary.riskyCommands, 1);
  assert.deepEqual(summary.worthReviewing, [
    "risky shell command observed at event 2: `rm -rf build`\n  Risk: destructive filesystem removal — recursively deletes files without a trash/undo step\n  Result: missing command completion evidence\n  Inspect: --event 2",
  ]);
});

test("findEvent refuses ambiguous sequence selectors and preserves event ID lookup", () => {
  const events = [
    event(1, "session.started", { id: "evt-first" }),
    event(1, "session.started", { id: "evt-second" }),
  ];

  assert.equal(findEvent(events, "1"), undefined);
  assert.equal(findEvent(events, "evt-second")?.id, "evt-second");
});

test("findEvent resolves events by id, unique id prefix, or sequence string", () => {
  const events = [event(1, "session.started"), event(2, "tool.requested", { id: "evt-tool-abcdef" })];

  assert.equal(findEvent(events, "evt-tool-abcdef")?.sequence, 2);
  assert.equal(findEvent(events, "evt-tool")?.sequence, 2);
  assert.equal(findEvent(events, "1")?.type, "session.started");
  assert.equal(findEvent(events, "missing"), undefined);
});

test("filterEvidenceEvents supports activity, type, grep, and latest-limit filtering", () => {
  const events = [
    event(1, "tool.requested", { toolName: "bash", payload: { input: { command: "npm test" } } }),
    event(2, "tool.completed", { toolName: "bash", payload: { content: [{ type: "text", text: "tests passed" }] } }),
    event(3, "tool.requested", { toolName: "read", payload: { input: { path: "README.md" } } }),
    event(4, "capture.gap", { payload: { command: "deploy preview", reason: "write failed" } }),
    event(5, "tool.requested", { toolName: "bash", payload: { input: { command: "deploy production" } } }),
  ];

  assert.deepEqual(filterEvidenceEvents(events, { activities: ["shell"] }).matches.map((item) => item.sequence), [1, 2, 5]);
  assert.deepEqual(filterEvidenceEvents(events, { activities: ["shell"], grep: "deploy" }).matches.map((item) => item.sequence), [5]);
  assert.deepEqual(filterEvidenceEvents(events, { eventTypes: ["capture.gap"] }).matches.map((item) => item.sequence), [4]);
  const limited = filterEvidenceEvents(events, { activities: ["shell"], limit: 2 });
  assert.equal(limited.totalMatches, 3);
  assert.deepEqual(limited.matches.map((item) => item.sequence), [2, 5]);
});

test("filterEvidenceEvents supports file, git, risk, capture, prompt, tool, and lifecycle categories", () => {
  const events = [
    event(1, "agent.before_start", { payload: { prompt: "Do work" } }),
    event(2, "tool.requested", { toolName: "read", payload: { input: { path: "README.md" } } }),
    event(3, "tool.requested", { toolName: "bash", payload: { input: { command: "rm -rf build" } } }),
    event(4, "git.status.snapshot", { payload: { phase: "start" } }),
    event(5, "capture.gap", { payload: { reason: "failed" } }),
    event(6, "session.shutdown"),
  ];

  assert.deepEqual(filterEvidenceEvents(events, { activities: ["file"] }).matches.map((item) => item.sequence), [2]);
  assert.deepEqual(filterEvidenceEvents(events, { activities: ["git"] }).matches.map((item) => item.sequence), [4]);
  assert.deepEqual(filterEvidenceEvents(events, { activities: ["risk"] }).matches.map((item) => item.sequence), [3]);
  assert.deepEqual(filterEvidenceEvents(events, { activities: ["capture"] }).matches.map((item) => item.sequence), [5]);
  assert.deepEqual(filterEvidenceEvents(events, { activities: ["prompt"] }).matches.map((item) => item.sequence), [1]);
  assert.deepEqual(filterEvidenceEvents(events, { activities: ["tool"] }).matches.map((item) => item.sequence), [2, 3]);
  assert.deepEqual(filterEvidenceEvents(events, { activities: ["lifecycle"] }).matches.map((item) => item.sequence), [6]);
});

test("filterEvidenceEvents defaults to the latest 50 matches", () => {
  const events = Array.from({ length: 55 }, (_, index) => event(index + 1, "tool.requested", { toolName: "bash", payload: { input: { command: `echo ${index + 1}` } } }));
  const filtered = filterEvidenceEvents(events, { activities: ["shell"] });

  assert.equal(filtered.totalMatches, 55);
  assert.equal(filtered.matches.length, 50);
  assert.equal(filtered.matches[0]?.sequence, 6);
  assert.equal(filtered.matches[49]?.sequence, 55);
});

test("formatFilteredEvents compacts long multiline text but preserves complete JSONL", () => {
  const command = `deploy preview\n${"x".repeat(300)}`;
  const events = [event(1, "tool.requested", { id: "evt-long", toolName: "bash", payload: { input: { command } } })];
  const text = formatFilteredEvents("1", events, 1, "text");
  const jsonl = formatFilteredEvents("1", events, 1, "jsonl");

  assert.doesNotMatch(text, /\n+x{20}/);
  assert.match(text, /deploy preview x+…/);
  assert.equal(JSON.parse(jsonl).payload.input.command, command);
});

test("formatFilteredEvents renders text metadata and clean JSONL", () => {
  const events = [event(1, "tool.requested", { id: "evt-shell", toolName: "bash", payload: { input: { command: "npm test" } } })];
  const text = formatFilteredEvents("1", events, 3, "text");
  assert.match(text, /Showing latest 1 of 3 matching events/);
  assert.match(text, /Running · npm test/);
  assert.match(text, /--all/);

  const jsonl = formatFilteredEvents("1", events, 3, "jsonl");
  assert.equal(jsonl.trim().split("\n").length, 1);
  assert.equal(JSON.parse(jsonl).id, "evt-shell");
  assert.doesNotMatch(jsonl, /matching events|Inspect/);
});

test("formatActivityList documents supported activity categories", () => {
  const output = formatActivityList();
  for (const activity of ["shell", "file", "git", "risk", "capture", "prompt", "tool", "lifecycle"]) {
    assert.match(output, new RegExp(`^${activity}\\s`, "m"));
  }
});

test("formatTimelineEvent prefixes rendered events with sequence and event-id prefix", () => {
  assert.equal(
    formatTimelineEvent(event(17, "tool.requested", { id: "msdmhl3r-7cifg5sy", timestamp: "2026-08-03T12:00:00.000Z", toolName: "edit", payload: { input: { path: "sample.txt" } } })),
    "17  msdmhl3r  08:00:00  Editing · sample.txt",
  );
});

test("buildAttachStatus does not resurrect old unmatched activity while restart metadata is ahead of events", () => {
  const status = buildAttachStatus([
    event(1, "session.started", { id: "old-start" }),
    event(2, "tool.requested", { id: "old-request", toolName: "bash", toolCallId: "old-call", payload: { toolCallId: "old-call", input: { command: "old command" } } }),
    event(3, "session.shutdown", { id: "old-shutdown" }),
    event(4, "message.ended", { id: "legacy-post-shutdown" }),
  ], true);

  assert.equal(status.activityLabel, "Last activity");
  assert.equal(status.activity, "Pi session ended");
  assert.equal(status.eventCount, 4);
});

test("buildAttachStatus ignores unmatched requests from before the latest recorded restart", () => {
  const status = buildAttachStatus([
    event(1, "session.started", { id: "old-start" }),
    event(2, "tool.requested", { id: "old-request", toolName: "bash", toolCallId: "old-call", payload: { toolCallId: "old-call", input: { command: "old command" } } }),
    event(3, "session.shutdown", { id: "old-shutdown" }),
    event(1, "session.started", { id: "new-start" }),
  ], true);

  assert.equal(status.activityLabel, "Last activity");
  assert.equal(status.activity, "Pi session started");
  assert.equal(status.eventCount, 4);
});

test("buildAttachStatus does not claim uncorrelatable requests as current", () => {
  const status = buildAttachStatus([
    event(1, "session.started"),
    event(2, "tool.requested", { toolName: "bash", payload: { input: { command: "npm test" } } }),
  ], true);

  assert.equal(status.activityLabel, "Last activity");
  assert.equal(status.evidence, "recorded event");
});

test("buildAttachStatus reports only correlated unmatched tool requests as current", () => {
  const now = Date.parse("2026-08-13T12:00:10.000Z");
  const status = buildAttachStatus([
    event(1, "session.started", { timestamp: "2026-08-13T12:00:00.000Z" }),
    event(2, "tool.requested", { id: "request-1", timestamp: "2026-08-13T12:00:02.000Z", toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", input: { command: "npm test" } } }),
  ], true, now);

  assert.deepEqual(status, {
    state: "active",
    activityLabel: "Current activity",
    activity: "Running · npm test",
    evidence: "request recorded; completion not recorded yet",
    capture: "No recorded capture limitations",
    captureSummary: { state: "ok", gaps: 0, missing: 0, redacted: 0, truncated: 0 },
    eventCount: 2,
    lastObserved: "8s ago",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(status)).captureSummary, {
    state: "ok",
    gaps: 0,
    missing: 0,
    redacted: 0,
    truncated: 0,
  });
});

test("buildAttachStatus uses append-order completion correlation and falls back to last activity", () => {
  const now = Date.parse("2026-08-13T12:00:10.000Z");
  const status = buildAttachStatus([
    event(1, "tool.completed", { timestamp: "2026-08-13T12:00:01.000Z", toolName: "read", toolCallId: "reused", payload: { toolCallId: "reused" } }),
    event(2, "tool.requested", { timestamp: "2026-08-13T12:00:02.000Z", toolName: "read", toolCallId: "reused", payload: { toolCallId: "reused", input: { path: "README.md" } } }),
    event(3, "tool.completed", { timestamp: "2026-08-13T12:00:03.000Z", toolName: "read", toolCallId: "reused", payload: { toolCallId: "reused" } }),
  ], true, now);

  assert.equal(status.activityLabel, "Last activity");
  assert.equal(status.activity, "read complete");
  assert.equal(status.evidence, "recorded event");
  assert.equal(status.lastObserved, "7s ago");
});

test("buildAttachStatus ignores narrated events appended after completed-session shutdown", () => {
  const status = buildAttachStatus([
    event(1, "session.started"),
    event(2, "session.shutdown"),
    event(3, "tool.requested", { toolName: "bash", toolCallId: "late-call", payload: { toolCallId: "late-call", input: { command: "late command" } } }),
  ], false);

  assert.equal(status.activityLabel, "Last activity");
  assert.equal(status.activity, "Pi session ended");
  assert.equal(status.eventCount, 3);
});

test("buildAttachStatus summarizes partial capture and does not claim current activity for completed sessions", () => {
  const status = buildAttachStatus([
    event(1, "tool.requested", { timestamp: "invalid", toolName: "edit", toolCallId: "call-edit", payload: { toolCallId: "call-edit", input: { path: "README.md" } } }),
    event(2, "capture.gap", { capture: { missing: ["event:tool.completed"], redacted: ["payload.secret"], truncated: ["payload.output"] } }),
    event(3, "message.ended", { capture: { missing: ["turnId"], redacted: ["payload.token"], truncated: ["payload.content"] } }),
    event(4, "session.shutdown", { timestamp: "invalid" }),
  ], false, Date.parse("2026-08-13T12:00:10.000Z"));

  assert.equal(status.state, "complete");
  assert.equal(status.activityLabel, "Last activity");
  assert.equal(status.activity, "Pi session ended");
  assert.equal(status.capture, "Partial · 1 capture gap · 1 event with missing fields · 2 redacted events · 2 truncated events");
  assert.equal(status.lastObserved, "unknown");
});

test("formatAttachStatus renders an aligned status block for empty sessions", () => {
  const output = formatAttachStatus(buildAttachStatus([], true, Date.now()));
  assert.match(output, /^Live status/m);
  assert.match(output, /State\s+active/);
  assert.match(output, /Last activity\s+No narrated activity recorded/);
  assert.match(output, /Evidence\s+no narrated event evidence/);
  assert.match(output, /Capture\s+No capture metadata recorded/);
  assert.match(output, /Events\s+0/);
  assert.match(output, /Last observed\s+unknown/);
});

test("formatAttachStatus compacts multiline activity", () => {
  const output = formatAttachStatus({
    state: "active",
    activityLabel: "Current activity",
    activity: `Running · npm test\necho done\n${"x".repeat(300)}`,
    evidence: "request recorded; completion not recorded yet",
    capture: "No recorded capture limitations",
    captureSummary: { state: "ok", gaps: 0, missing: 0, redacted: 0, truncated: 0 },
    eventCount: 2,
    lastObserved: "1s ago",
  });
  assert.doesNotMatch(output, /\necho done/);
  assert.match(output, /Current activity\s+Running · npm test echo done x+…/);
});

test("formatAttachStatus labels completed sessions as session status", () => {
  const output = formatAttachStatus(buildAttachStatus([event(1, "session.shutdown")], false));
  assert.match(output, /^Session status/m);
  assert.doesNotMatch(output, /^Live status/m);
});

test("selectAttachHistory bounds only narrated startup events and preserves all event IDs", () => {
  const events = [
    event(1, "session.started", { id: "evt-1" }),
    event(2, "message.started", { id: "evt-2" }),
    event(3, "tool.requested", { id: "evt-3", toolName: "read", payload: { input: { path: "one.md" } } }),
    event(4, "message.ended", { id: "evt-4" }),
    event(5, "tool.requested", { id: "evt-5", toolName: "read", payload: { input: { path: "two.md" } } }),
  ];

  const bounded = selectAttachHistory(events, 2, false);
  assert.deepEqual(bounded.visible.map((item) => item.id), ["evt-3", "evt-5"]);
  assert.equal(bounded.narratedTotal, 3);
  assert.deepEqual([...bounded.seenEventIds], ["evt-1", "evt-2", "evt-3", "evt-4", "evt-5"]);

  assert.deepEqual(selectAttachHistory(events, 0, false).visible, []);
  assert.deepEqual(selectAttachHistory(events, 50, true).visible.map((item) => item.id), ["evt-1", "evt-3", "evt-5"]);
});

test("formatAttachGuidance explains bounded history and next CLI actions", () => {
  const output = formatAttachGuidance("2", {
    recordedTotal: 103,
    narratedTotal: 78,
    narratedShown: 50,
    active: true,
  });

  assert.match(output, /Showing latest 50 of 78 narrated historical events/);
  assert.match(output, /25 recorded events have no default timeline narration/);
  assert.match(output, /--all-history/);
  assert.match(output, /bashguard inspect 2 list events/);
  assert.match(output, /bashguard inspect 2 --event <sequence-or-event-id-prefix>/);
  assert.match(output, /bashguard debrief 2/);
  assert.match(output, /Following live events/);
});

test("formatInspectableEvents prefers an event ID when the first sequence is ambiguous", () => {
  const output = formatInspectableEvents("1", [
    event(1, "session.started", { id: "evt-first-abcdef" }),
    event(1, "agent.ended", { id: "evt-second-abcdef" }),
  ]);

  assert.match(output, /bashguard inspect 1 --event evt-firs/);
  assert.doesNotMatch(output, /bashguard inspect 1 --event 1\n/);
});

test("formatInspectableEvents lists events and next inspect command when no event is selected", () => {
  const output = formatInspectableEvents("1", [
    event(1, "session.started", { id: "evt-start-abcdef", timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { id: "evt-tool-abcdef", timestamp: "2026-08-03T12:00:01.000Z", toolName: "bash", payload: { input: { command: "npm test" } } }),
  ]);

  assert.match(output, /Inspectable events/);
  assert.match(output, /1\s+evt-star\s+08:00:00\s+Pi session started/);
  assert.match(output, /2\s+evt-tool\s+08:00:01\s+Running · npm test/);
  assert.match(output, /Inspect by sequence or event ID prefix:/);
  assert.match(output, /bashguard inspect 1 --event 1/);
  assert.match(output, /bashguard inspect 1 --event evt-star/);
});

test("parseJsonlEvents preserves append order when recorder sequences repeat", () => {
  const parsed = parseJsonlEvents(`${JSON.stringify(event(1, "session.started", { id: "first" }))}\n${JSON.stringify(event(1, "session.started", { id: "second" }))}\n`);

  assert.deepEqual(parsed.map((item) => item.id), ["first", "second"]);
});

test("normalizeEvent defaults missing capture metadata for older events", () => {
  assert.deepEqual(normalizeEvent(event(1, "session.started")).capture, { missing: [], redacted: [], truncated: [] });
});

test("buildDebrief treats events without explicit capture gaps as complete capture", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { toolName: "read", payload: { input: { path: "README.md" } } }),
    event(3, "session.shutdown", { timestamp: "2026-08-03T12:00:01.000Z" }),
  ]);

  assert.equal(summary.captureState, "Complete");
  assert.deepEqual(summary.worthReviewing, []);
});

test("formatEventInspection explains read file tool activity", () => {
  const output = formatEventInspection(event(2, "tool.requested", {
    toolName: "read",
    payload: { input: { path: "README.md" } },
  }));

  assert.match(output, /Tool\s+read/);
  assert.match(output, /Path\s+README\.md/);
  assert.match(output, /File action\s+read/);
  assert.match(output, /File meaning\s+Pi read file contents/);
});

test("formatEventInspection explains edit file tool activity", () => {
  const output = formatEventInspection(event(3, "tool.requested", {
    toolName: "edit",
    payload: { input: { path: "src\/cli.ts" } },
  }));

  assert.match(output, /File action\s+edit/);
  assert.match(output, /File meaning\s+Pi requested targeted text replacement/);
});

test("formatEventInspection explains write tool activity without inferring create or overwrite", () => {
  const output = formatEventInspection(event(4, "tool.requested", {
    toolName: "write",
    payload: { input: { path: "docs\/example.md" } },
  }));

  assert.match(output, /File action\s+write tool/);
  assert.match(output, /File meaning\s+Pi wrote full file content; may create, overwrite, or leave content unchanged/);
});

test("formatEventInspection explains git status snapshots", () => {
  const output = formatEventInspection(event(5, "git.status.snapshot", {
    payload: {
      phase: "shutdown",
      isRepository: true,
      branch: "agent/git-inspect",
      worktree: "/tmp/worktrees/git-inspect",
      gitCommonDir: "/tmp/repo/.git",
      changedFiles: ["README.md", "notes/new.md"],
      changedFileDetails: [
        { path: "README.md", status: "M", additions: 12, deletions: 3, lineRanges: ["14-18", "42"] },
        { path: "notes/new.md", status: "??" },
      ],
      changedFileCount: 2,
    },
  }));

  assert.match(output, /Git phase\s+shutdown/);
  assert.match(output, /Git repository\s+yes/);
  assert.match(output, /Git branch\s+agent\/git-inspect/);
  assert.match(output, /Git worktree\s+\/tmp\/worktrees\/git-inspect/);
  assert.match(output, /Git common dir\s+\/tmp\/repo\/\.git/);
  assert.match(output, /Git state\s+dirty/);
  assert.match(output, /Changed paths\s+2/);
  assert.match(output, /Git changed files/);
  assert.match(output, /- M README\.md \(\+12 -3\)\n  Lines: 14-18, 42/);
  assert.match(output, /- \?\? notes\/new\.md/);
  assert.doesNotMatch(output, /Observed matching file tool event/);
});

test("formatEventInspection prints event evidence, capture metadata, and useful tool context", () => {
  const output = formatEventInspection(event(3, "tool.requested", {
    evidence: "observed",
    capture: { missing: ["turnId"], redacted: ["payload.input.apiKey"], truncated: ["payload.input.edits.0.newText"] },
    cwd: "/tmp/repo",
    toolName: "bash",
    toolCallId: "call-123",
    payload: { input: { command: "npm test" } },
  }));

  assert.match(output, /Sequence\s+3/);
  assert.match(output, /Type\s+tool\.requested/);
  assert.match(output, /Evidence\s+observed/);
  assert.match(output, /Missing\s+turnId/);
  assert.match(output, /Redacted\s+payload\.input\.apiKey/);
  assert.match(output, /Truncated\s+payload\.input\.edits\.0\.newText/);
  assert.match(output, /Tool\s+bash/);
  assert.match(output, /Tool call\s+call-123/);
  assert.match(output, /Command\s+npm test/);
  assert.match(output, /Payload/);
});

test("buildDebrief summarizes git status snapshot comparison", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "git.status.snapshot", { payload: { phase: "start", isRepository: true, branch: "main", worktree: "/tmp/project", changedFiles: [] } }),
    event(3, "tool.requested", { toolName: "edit", payload: { input: { path: "README.md" } } }),
    event(4, "tool.requested", { toolName: "write", payload: { input: { path: "src/cli.ts" } } }),
    event(5, "git.status.snapshot", { payload: { phase: "shutdown", isRepository: true, branch: "main", worktree: "/tmp/project", changedFiles: ["README.md", "src/cli.ts"], changedFileDetails: [
      { path: "README.md", status: "M", additions: 12, deletions: 3, lineRanges: ["14-18", "42"] },
      { path: "src/cli.ts", status: "A", additions: 40, deletions: 0, lineRanges: ["1-40"] },
      { path: "notes/new.md", status: "??" },
    ] } }),
    event(6, "session.shutdown", { timestamp: "2026-08-03T12:00:05.000Z" }),
  ]);

  assert.equal(summary.gitStatus, "clean -> dirty");
  assert.equal(summary.gitBranch, "main");
  assert.equal(summary.gitWorktree, "/tmp/project");
  assert.equal(summary.gitChangedPaths, "0 -> 2");
  assert.deepEqual(summary.gitChangedFiles, [
    "M README.md (+12 -3)\n  Lines: 14-18, 42\n  Observed matching file tool event: edit at event 3\n  Correlation confidence: direct path match\n  Inspect: --event 3",
    "A src/cli.ts (+40 -0)\n  Lines: 1-40\n  Observed matching file tool event: write tool at event 4\n  Correlation confidence: direct path match\n  Inspect: --event 4",
    "?? notes/new.md\n  Observed matching file tool event: none recorded\n  Correlation confidence: no direct file-tool match",
  ]);
  assert.deepEqual(summary.nextInspectCommands, [
    "bashguard inspect <session> --event 5  # shutdown Git snapshot",
    "bashguard inspect <session> --event 3  # matching file tool event for README.md",
    "bashguard inspect <session> --event 4  # matching file tool event for src/cli.ts",
  ]);
  assert.deepEqual(summary.worthReviewing, ["Git working tree changed during session: 0 -> 2 changed paths"]);
  assert.deepEqual(summary.evidenceCompleteness, [
    "Capture gaps: 0",
    "Redacted events: 0",
    "Truncated events: 0",
    "Events with missing fields: 0",
    "Git snapshots: start + shutdown present",
    "Command results: no bash commands observed",
  ]);
});

test("buildDebrief flags risky commands before Git changes as temporal-only correlation", () => {
  const summary = buildDebrief([
    event(1, "session.started"),
    event(2, "git.status.snapshot", { payload: { phase: "start", isRepository: true, branch: "main", worktree: "/tmp/project", changedFiles: [] } }),
    event(3, "tool.requested", { toolName: "bash", toolCallId: "call-risk", payload: { toolCallId: "call-risk", input: { command: "rm -rf build" } } }),
    event(4, "tool.completed", { toolName: "bash", toolCallId: "call-risk", payload: { toolCallId: "call-risk", isError: false, details: { exitCode: 0 } } }),
    event(5, "git.status.snapshot", { payload: { phase: "shutdown", isRepository: true, branch: "main", worktree: "/tmp/project", changedFiles: ["README.md"], changedFileDetails: [{ path: "README.md", status: "M" }] } }),
    event(6, "session.shutdown"),
  ]);

  assert.deepEqual(summary.worthReviewing, [
    "risky shell command observed at event 3: `rm -rf build`\n  Risk: destructive filesystem removal — recursively deletes files without a trash/undo step\n  Result: exit 0\n  Inspect: --event 3",
    "Git working tree changed during session: 0 -> 1 changed paths",
    "Risky shell command occurred before shutdown Git snapshot that showed changes\n  Risk events: 3\n  Git evidence: shutdown snapshot at event 5 showed 1 changed path\n  Correlation confidence: temporal proximity only",
  ]);
  assert.deepEqual(summary.nextInspectCommands, [
    "bashguard inspect <session> --event 3  # risky shell command",
    "bashguard inspect <session> --event 5  # shutdown Git snapshot",
  ]);
});

test("buildDebrief does not add temporal risk/Git correlation when Git did not change", () => {
  const summary = buildDebrief([
    event(1, "session.started"),
    event(2, "git.status.snapshot", { payload: { phase: "start", isRepository: true, branch: "main", worktree: "/tmp/project", changedFiles: [] } }),
    event(3, "tool.requested", { toolName: "bash", toolCallId: "call-risk", payload: { toolCallId: "call-risk", input: { command: "rm -rf build" } } }),
    event(4, "tool.completed", { toolName: "bash", toolCallId: "call-risk", payload: { toolCallId: "call-risk", isError: false, details: { exitCode: 0 } } }),
    event(5, "git.status.snapshot", { payload: { phase: "shutdown", isRepository: true, branch: "main", worktree: "/tmp/project", changedFiles: [] } }),
    event(6, "session.shutdown"),
  ]);

  assert.deepEqual(summary.worthReviewing, [
    "risky shell command observed at event 3: `rm -rf build`\n  Risk: destructive filesystem removal — recursively deletes files without a trash/undo step\n  Result: exit 0\n  Inspect: --event 3",
  ]);
});

test("buildDebrief summarizes observed GitHub activity without live GitHub queries", () => {
  const summary = buildDebrief([
    event(1, "tool.requested", { toolName: "bash", toolCallId: "push", payload: { toolCallId: "push", input: { command: "git push origin main" } } }),
    event(2, "tool.completed", { toolName: "bash", toolCallId: "push", payload: { toolCallId: "push", isError: false, content: [{ type: "text", text: "To https://github.com/example/repo.git\n   abc123..def456  main -> main\n" }] } }),
    event(3, "tool.requested", { toolName: "bash", toolCallId: "create", payload: { toolCallId: "create", input: { command: "gh pr create --title \"Demo\" --body \"Body\"" } } }),
    event(4, "tool.completed", { toolName: "bash", toolCallId: "create", payload: { toolCallId: "create", isError: false, content: [{ type: "text", text: "https://github.com/example/repo/pull/11\n" }] } }),
    event(5, "tool.requested", { toolName: "bash", toolCallId: "merge", payload: { toolCallId: "merge", input: { command: "gh pr merge 11 --squash --delete-branch" } } }),
    event(6, "tool.completed", { toolName: "bash", toolCallId: "merge", payload: { toolCallId: "merge", isError: false, content: [{ type: "text", text: "✓ Merged pull request #11\n" }] } }),
    event(7, "tool.requested", { toolName: "bash", toolCallId: "run", payload: { toolCallId: "run", input: { command: "gh run watch 123 --exit-status" } } }),
    event(8, "tool.completed", { toolName: "bash", toolCallId: "run", payload: { toolCallId: "run", isError: false, content: [{ type: "text", text: "✓ main Seed published articles · 123\n" }] } }),
  ]);

  assert.deepEqual(summary.githubActivity, [
    "git push observed at event 1\n  Command: git push origin main\n  Reported: main -> main\n  Evidence: recorded shell command/output\n  Inspect: --event 1",
    "GitHub PR creation observed at event 3\n  Title: Demo\n  Command: gh pr create --title \"Demo\" ...\n  Reported: https://github.com/example/repo/pull/11\n  Evidence: recorded shell command/output\n  Inspect: --event 3",
    "GitHub PR merge observed at event 5\n  PR: 11\n  Command: gh pr merge 11 --squash --delete-branch\n  Reported: ✓ Merged pull request #11\n  Evidence: recorded shell command/output\n  Inspect: --event 5",
    "GitHub Actions run observed at event 7\n  Run: 123\n  Command: gh run watch 123 --exit-status\n  Reported: ✓ main Seed published articles · 123\n  Evidence: recorded shell command/output\n  Inspect: --event 7",
  ]);
  assert.deepEqual(summary.nextInspectCommands, [
    "bashguard inspect <session> --event 1  # GitHub activity: git push",
    "bashguard inspect <session> --event 3  # GitHub activity: PR creation",
    "bashguard inspect <session> --event 5  # GitHub activity: PR merge",
    "bashguard inspect <session> --event 7  # GitHub activity: Actions run",
  ]);
});

test("buildDebrief reports combined git push and GitHub PR creation commands separately", () => {
  const summary = buildDebrief([
    event(1, "tool.requested", { toolName: "bash", toolCallId: "combo", payload: { toolCallId: "combo", input: { command: "git push -u origin feature && gh pr create --title \"Feature title\" --body \"Long body\"" } } }),
    event(2, "tool.completed", { toolName: "bash", toolCallId: "combo", payload: { toolCallId: "combo", isError: false, content: [{ type: "text", text: "feature -> feature\nhttps://github.com/example/repo/pull/12\n" }] } }),
  ]);

  assert.deepEqual(summary.githubActivity, [
    "git push observed at event 1\n  Command: git push -u origin feature\n  Reported: feature -> feature\n  Evidence: recorded shell command/output\n  Inspect: --event 1",
    "GitHub PR creation observed at event 1\n  Title: Feature title\n  Command: gh pr create --title \"Feature title\" ...\n  Reported: https://github.com/example/repo/pull/12\n  Evidence: recorded shell command/output\n  Inspect: --event 1",
  ]);
});

test("buildDebrief summarizes recorded shell activity without provider-specific assumptions", () => {
  const summary = buildDebrief([
    event(1, "tool.requested", { toolName: "bash", toolCallId: "deploy", payload: { toolCallId: "deploy", input: { command: "acme deploy --production" } } }),
    event(2, "tool.completed", { toolName: "bash", toolCallId: "deploy", payload: { toolCallId: "deploy", isError: false, content: [{ type: "text", text: "release-42 ready at https://example.invalid\n" }] } }),
    event(3, "tool.requested", { toolName: "bash", toolCallId: "verify", payload: { toolCallId: "verify", input: { command: "custom-platform verify --target production\npython3 verify.py" } } }),
    event(4, "tool.completed", { toolName: "bash", toolCallId: "verify", payload: { toolCallId: "verify", isError: false, content: [{ type: "text", text: "status: healthy\n" }] } }),
  ]);

  assert.deepEqual(summary.externalActivity, [
    "Recorded shell command observed at event 1\n  Command: acme deploy --production\n  Reported: release-42 ready at https://example.invalid\n  Evidence: recorded shell command/output\n  Inspect: --event 1",
    "Recorded shell command observed at event 3\n  Command: custom-platform verify --target production ...\n  Reported: status: healthy\n  Evidence: recorded shell command/output\n  Inspect: --event 3",
  ]);
  assert.deepEqual(summary.nextInspectCommands, []);
});

test("buildDebrief summarizes prompts, tools, shell commands, files, failures, and capture gaps", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "agent.before_start", { payload: { prompt: "Run tests" } }),
    event(3, "tool.requested", { toolName: "read", payload: { input: { path: "README.md" } } }),
    event(4, "tool.requested", { toolName: "bash", payload: { input: { command: "npm test" } } }),
    event(5, "tool.completed", { toolName: "bash", payload: { isError: false, details: { exitCode: 1 } } }),
    event(6, "tool.requested", { toolName: "edit", payload: { input: { path: "result.txt" } } }),
    event(7, "tool.requested", { toolName: "write", payload: { input: { path: "docs/example.md" } } }),
    event(8, "tool.requested", { toolName: "bash", capture: { missing: ["turnId"], redacted: ["payload.input.apiKey"], truncated: ["payload.input.edits.0.newText"] }, payload: { input: { command: "git status" } } }),
    event(9, "tool.completed", { toolName: "bash", payload: { isError: false } }),
    event(10, "session.shutdown", { timestamp: "2026-08-03T12:00:08.000Z" }),
  ]);

  assert.equal(summary.durationMs, 8_000);
  assert.equal(summary.prompts, 1);
  assert.equal(summary.toolCalls, 5);
  assert.equal(summary.shellCommands, 2);
  assert.equal(summary.filesObserved, 3);
  assert.equal(summary.fileToolActions, 3);
  assert.deepEqual(summary.fileActivity, [
    "read README.md\n  Meaning: Pi read file contents\n  Evidence: read tool event\n  Inspect: --event 3",
    "edit result.txt\n  Meaning: Pi requested targeted text replacement\n  Evidence: edit tool event\n  Inspect: --event 6",
    "write tool docs/example.md\n  Meaning: Pi wrote full file content; may create, overwrite, or leave content unchanged\n  Evidence: write tool event\n  Inspect: --event 7",
  ]);
  assert.equal(summary.failedCommands, 1);
  assert.equal(summary.riskyCommands, 0);
  assert.equal(summary.gitStatus, undefined);
  assert.equal(summary.gitChangedPaths, undefined);
  assert.equal(summary.captureState, "Partial");
  assert.deepEqual(summary.evidenceCompleteness, [
    "Capture gaps: 0",
    "Redacted events: 1",
    "Truncated events: 1",
    "Events with missing fields: 1",
    "Git snapshots: missing",
    "Command results: 1/2 bash commands have exit-code evidence",
  ]);
  assert.deepEqual(summary.worthReviewing, [
    "one shell command completed without exit-code details",
    "one shell command failed",
    "one event has missing capture fields",
    "one event has redacted fields (values hidden; run inspect on related events to see redacted paths)",
    "one event has truncated fields (large values shortened; run inspect to see truncated paths)",
  ]);
});

test("buildDebrief combines failed bash commands that have no exit-code details into one review note", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", input: { command: "npm test" } } }),
    event(3, "tool.completed", { toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", isError: true } }),
    event(4, "session.shutdown", { timestamp: "2026-08-03T12:00:01.000Z" }),
  ]);

  assert.equal(summary.failedCommands, 1);
  assert.deepEqual(summary.worthReviewing, ["shell command failed without exit-code details: `npm test`"]);
});

test("buildDebrief extracts bash exit code from command output when details are empty", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", input: { command: "bashguard debrief session" } } }),
    event(3, "tool.completed", {
      toolName: "bash",
      toolCallId: "call-1",
      payload: {
        toolCallId: "call-1",
        isError: true,
        details: {},
        content: [{ type: "text", text: "/bin/bash: bashguard: command not found\n\n\nCommand exited with code 127" }],
      },
    }),
    event(4, "session.shutdown", { timestamp: "2026-08-03T12:00:01.000Z" }),
  ]);

  assert.equal(summary.failedCommands, 1);
  assert.deepEqual(summary.worthReviewing, ["shell command failed with exit 127: `bashguard debrief session`"]);
});

test("formatDebrief renders a concise aligned completed-session summary", () => {
  const output = formatDebrief({
    durationMs: 8_000,
    prompts: 1,
    toolCalls: 4,
    shellCommands: 2,
    filesObserved: 2,
    fileToolActions: 2,
    failedCommands: 1,
    riskyCommands: 1,
    gitStatus: "clean -> dirty",
    gitBranch: "main",
    gitWorktree: "/tmp/project",
    gitChangedPaths: "0 -> 2",
    gitChangedFiles: [
      "M README.md (+12 -3)\n  Lines: 14-18, 42\n  Observed matching file tool event: edit at event 3\n  Correlation confidence: direct path match\n  Inspect: --event 3",
      "A src/cli.ts (+40 -0)\n  Lines: 1-40\n  Observed matching file tool event: write tool at event 7\n  Correlation confidence: direct path match\n  Inspect: --event 7",
    ],
    githubActivity: ["git push observed at event 9\n  Command: git push origin main\n  Evidence: recorded shell command/output\n  Inspect: --event 9"],
    externalActivity: ["Recorded shell command observed at event 10\n  Command: acme deploy --production\n  Evidence: recorded shell command/output\n  Inspect: --event 10"],
    captureState: "Partial",
    worthReviewing: ["one shell command failed"],
    nextInspectCommands: [
      "bashguard inspect <session> --event 3  # risky shell command",
      "bashguard inspect <session> --event 7  # matching file tool event for src/cli.ts",
    ],
    evidenceCompleteness: [
      "Capture gaps: 0",
      "Redacted events: 0",
      "Truncated events: 0",
      "Events with missing fields: 0",
      "Git snapshots: start + shutdown present",
      "Command results: 1/2 bash commands have exit-code evidence",
    ],
    fileActivity: [
      "read README.md\n  Meaning: Pi read file contents\n  Evidence: read tool event\n  Inspect: --event 3",
      "write tool docs/example.md\n  Meaning: Pi wrote full file content; may create, overwrite, or leave content unchanged\n  Evidence: write tool event\n  Inspect: --event 7",
    ],
  });

  assert.match(output, /Session complete/);
  assert.match(output, /Duration\s+8s/);
  assert.match(output, /Prompts\s+1/);
  assert.match(output, /Tool calls\s+4/);
  assert.match(output, /Shell commands\s{2,}2/);
  assert.match(output, /Files observed\s{2,}2/);
  assert.match(output, /File tool actions\s{2,}2/);
  assert.match(output, /Failed commands\s{2,}1/);
  assert.match(output, /Risk notices\s{2,}1/);
  assert.match(output, /Git status\s{2,}clean -> dirty/);
  assert.match(output, /Git branch\s{2,}main/);
  assert.match(output, /Git worktree\s{2,}\/tmp\/project/);
  assert.match(output, /Git changed paths\s{2,}0 -> 2/);
  assert.match(output, /Capture state\s{2,}Partial/);
  assert.match(output, /Worth reviewing/);
  assert.match(output, /- one shell command failed/);
  assert.match(output, /GitHub activity/);
  assert.match(output, /- git push observed at event 9\n  Command: git push origin main\n  Evidence: recorded shell command\/output\n  Inspect: --event 9/);
  assert.match(output, /Observed shell activity/);
  assert.match(output, /- Recorded shell command observed at event 10\n  Command: acme deploy --production\n  Evidence: recorded shell command\/output\n  Inspect: --event 10/);
  assert.match(output, /Next inspect commands/);
  assert.match(output, /- bashguard inspect <session> --event 3  # risky shell command/);
  assert.match(output, /- bashguard inspect <session> --event 7  # matching file tool event for src\/cli\.ts/);
  const minimalSummary = {
    durationMs: 0,
    prompts: 0,
    toolCalls: 0,
    shellCommands: 0,
    filesObserved: 0,
    fileToolActions: 0,
    failedCommands: 0,
    riskyCommands: 0,
    gitChangedFiles: [],
    githubActivity: [],
    externalActivity: [],
    captureState: "Complete" as const,
    worthReviewing: [],
    nextInspectCommands: ["bashguard inspect <session> --event 3  # risky shell command"],
    evidenceCompleteness: [],
    fileActivity: [],
  };
  assert.match(formatDebrief(minimalSummary, { sessionSelector: "1" }), /- bashguard inspect 1 --event 3  # risky shell command/);
  assert.match(formatDebrief(minimalSummary, { sessionState: "active" }), /Session active/);
  assert.doesNotMatch(formatDebrief(minimalSummary, { sessionState: "active" }), /Session complete/);
  assert.match(output, /Git changed files/);
  assert.match(output, /Evidence completeness/);
  assert.match(output, /- Git snapshots: start \+ shutdown present/);
  assert.match(output, /- Command results: 1\/2 bash commands have exit-code evidence/);
  assert.match(output, /- M README\.md \(\+12 -3\)\n  Lines: 14-18, 42\n  Observed matching file tool event: edit at event 3\n  Correlation confidence: direct path match\n  Inspect: --event 3/);
  assert.match(output, /- A src\/cli\.ts \(\+40 -0\)\n  Lines: 1-40\n  Observed matching file tool event: write tool at event 7\n  Correlation confidence: direct path match\n  Inspect: --event 7/);
  assert.match(output, /File tool activity/);
  assert.match(output, /- read README\.md\n  Meaning: Pi read file contents\n  Evidence: read tool event\n  Inspect: --event 3/);
  assert.match(output, /- write tool docs\/example\.md\n  Meaning: Pi wrote full file content; may create, overwrite, or leave content unchanged\n  Evidence: write tool event\n  Inspect: --event 7/);
});

test("buildDebrief uses plural wording for multiple truncated events", () => {
  const summary = buildDebrief([
    event(1, "tool.completed", { capture: { missing: [], redacted: [], truncated: ["payload.details.patch"] } }),
    event(2, "tool.completed", { capture: { missing: [], redacted: [], truncated: ["payload.details.diff"] } }),
  ]);

  assert.deepEqual(summary.worthReviewing, [
    "2 events have truncated fields (large values shortened; run inspect to see truncated paths)",
  ]);
});

test("buildDebrief reports capture gap events", () => {
  const summary = buildDebrief([
    event(1, "session.started"),
    event(2, "capture.gap", { evidence: "missing", capture: { missing: ["event:tool.completed"], redacted: [], truncated: [] }, payload: { reason: "failed to persist tool.completed event", failedToolName: "bash", command: "curl google.com" } }),
    event(3, "session.shutdown"),
  ]);

  assert.equal(summary.captureState, "Partial");
  assert.deepEqual(summary.worthReviewing, ["one capture gap occurred during recording: bash `curl google.com`"]);
  assert.deepEqual(summary.nextInspectCommands, ["bashguard inspect <session> --event 2  # capture gap"]);
  assert.match(formatDebrief(summary), /Capture state\s+Partial \(capture gap recorded\)/);
});
