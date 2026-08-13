import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

test("package manifest loads BashGuard extension and skill as a Pi package", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const skill = await readFile("skills/bashguard/SKILL.md", "utf8");

  assert.deepEqual(packageJson.pi?.extensions, ["./extensions/bashguard/index.ts"]);
  assert.deepEqual(packageJson.pi?.skills, ["./skills"]);
  assert.match(skill, /^---\nname: bashguard\n/m);
  assert.match(skill, /^description: .+\n---\n/m);
});

test("package development dependency stays installable on the Pi 0.84.0 baseline", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"], "*");
  assert.equal(packageJson.devDependencies?.["@earendil-works/pi-coding-agent"], "0.84.0");
});

test("package exposes a shell-friendly bashguard bin wrapper", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.bin?.bashguard, "./bin/bashguard");

  const wrapper = await readFile("bin/bashguard", "utf8");
  await access("bin/bashguard");
  assert.match(wrapper, /^#!\/usr\/bin\/env node/);
  assert.match(wrapper, /--experimental-strip-types/);
  assert.match(wrapper, /join\(root, "src", "cli\.ts"\)/);
});
