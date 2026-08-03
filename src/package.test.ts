import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("package manifest loads BashGuard extension and skill as a Pi package", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const skill = await readFile("skills/bashguard/SKILL.md", "utf8");

  assert.deepEqual(packageJson.pi?.extensions, ["./extensions/bashguard/index.ts"]);
  assert.deepEqual(packageJson.pi?.skills, ["./skills"]);
  assert.match(skill, /^---\nname: bashguard\n/m);
  assert.match(skill, /^description: .+\n---\n/m);
});
