import assert from "node:assert/strict";
import test from "node:test";

import { dcgFixtureProtocol, validateDcgFixtureProtocol } from "./dcg-fixture.ts";

test("dcg fixture protocol is deterministic, sanitized, and complete", () => {
  const fixtures = dcgFixtureProtocol();
  assert.equal(fixtures.length >= 6, true);
  assert.equal(validateDcgFixtureProtocol(fixtures).length, fixtures.length);
  assert.equal(new Set(fixtures.map((fixture) => fixture.id)).size, fixtures.length);

  for (const fixture of fixtures) {
    assert.match(fixture.id, /^dg-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(fixture.expectation.repositoryVerification, "not-claimed");
    assert.ok(fixture.expectation.notes.length > 0);
    assert.ok(fixture.command.length > 0);
  }
});

test("dcg fixture protocol rejects unsafe ids, empty notes, and repository-verification claims", () => {
  assert.throws(
    () =>
      validateDcgFixtureProtocol([
        {
          id: "dg-unsafe-id!",
          title: "unsafe",
          command: "git status",
          expectation: {
            surface: "robot-test",
            decision: "allow",
            exitCodes: [0],
            stdoutShape: "json",
            stderrShape: "silent",
            repositoryVerification: "not-claimed",
            notes: ["ok"],
          },
        },
      ]),
    /unsafe dcg fixture id/,
  );

  assert.throws(
    () =>
      validateDcgFixtureProtocol([
        {
          id: "dg-empty-note",
          title: "empty note",
          command: "git status",
          expectation: {
            surface: "robot-test",
            decision: "allow",
            exitCodes: [0],
            stdoutShape: "json",
            stderrShape: "silent",
            repositoryVerification: "not-claimed",
            notes: [""],
          },
        },
      ]),
    /contains an empty note/,
  );

  assert.throws(
    () =>
      validateDcgFixtureProtocol([
        {
          id: "dg-repo-claim",
          title: "repo claim",
          command: "git status",
          expectation: {
            surface: "robot-test",
            decision: "allow",
            exitCodes: [0],
            stdoutShape: "json",
            stderrShape: "silent",
            repositoryVerification: "verified" as never,
            notes: ["ok"],
          },
        },
      ]),
    /must not claim repository verification/,
  );
});
