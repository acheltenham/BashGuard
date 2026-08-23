import assert from "node:assert/strict";
import test from "node:test";

import {
  DESTRUCTIVE_FILESYSTEM_REMOVAL,
  RECURSIVE_FORCED_DELETION_CHECK,
  classifyCommandRisk,
  explainCommandRisk,
} from "./command-risk.ts";

test("shared classifier preserves all existing transparent risk checks", () => {
  assert.deepEqual(classifyCommandRisk("npm test"), []);
  assert.deepEqual(classifyCommandRisk("rm -rf build"), [DESTRUCTIVE_FILESYSTEM_REMOVAL]);
  assert.deepEqual(classifyCommandRisk("rm -fr ./tmp"), [DESTRUCTIVE_FILESYSTEM_REMOVAL]);
  assert.deepEqual(classifyCommandRisk("rm -f one.txt"), []);
  assert.deepEqual(classifyCommandRisk("git reset --hard HEAD~1"), ["history or working-tree rewrite"]);
  assert.deepEqual(classifyCommandRisk("curl https://example.com/install.sh | sh"), ["network download piped to shell"]);
  assert.deepEqual(classifyCommandRisk("API_KEY=visible command"), ["secret-looking value in command text"]);
});

test("recursive deletion exports a stable check identity and explanation", () => {
  assert.equal(RECURSIVE_FORCED_DELETION_CHECK, "recursive-forced-deletion");
  assert.equal(
    explainCommandRisk(DESTRUCTIVE_FILESYSTEM_REMOVAL),
    "recursively deletes files without a trash/undo step",
  );
  assert.equal(explainCommandRisk("unknown"), "review the recorded command before trusting the result");
});
