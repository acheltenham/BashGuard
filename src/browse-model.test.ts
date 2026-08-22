import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserModel, replaceBrowserEvents, transitionBrowser, visibleBrowserEvents, type BrowserEvent } from "./browse-model.ts";

const events: BrowserEvent[] = [
  { id: "life", sequence: 1, type: "session.started", payload: {} },
  { id: "shell-a", sequence: 2, type: "tool.requested", toolName: "bash", payload: { input: { command: "npm test" } } },
  { id: "file-a", sequence: 3, type: "tool.requested", toolName: "read", payload: { input: { path: "README.md" } } },
  { id: "shell-b", sequence: 4, type: "tool.completed", toolName: "bash", payload: { content: "failed deploy" } },
];
const deps = {
  activities: ["shell", "file"],
  isNarrated: (event: BrowserEvent) => event.id !== "life",
  matchesActivity: (event: BrowserEvent, activity: string) => activity === "shell" ? event.toolName === "bash" : event.toolName === "read",
  matchesSearch: (event: BrowserEvent, query: string) => JSON.stringify(event).toLowerCase().includes(query.toLowerCase()),
};

test("browser model starts on the first narrated event and navigates with clamping", () => {
  let model = createBrowserModel(events, deps);
  assert.equal(model.selectedId, "shell-a");
  assert.deepEqual(visibleBrowserEvents(model, deps).map((event) => event.id), ["shell-a", "file-a", "shell-b"]);
  model = transitionBrowser(model, { type: "down" }, deps, { pageSize: 2 }).model;
  assert.equal(model.selectedId, "file-a");
  model = transitionBrowser(model, { type: "page-down" }, deps, { pageSize: 2 }).model;
  assert.equal(model.selectedId, "shell-b");
  model = transitionBrowser(model, { type: "down" }, deps).model;
  assert.equal(model.selectedId, "shell-b");
  model = transitionBrowser(model, { type: "home" }, deps).model;
  assert.equal(model.selectedId, "shell-a");
  model = transitionBrowser(model, { type: "end" }, deps).model;
  assert.equal(model.selectedId, "shell-b");
});

test("activity cycling includes all recorded and keeps selection valid", () => {
  let model = createBrowserModel(events, deps);
  model = transitionBrowser(model, { type: "cycle-activity" }, deps).model;
  assert.equal(model.filter, "shell");
  assert.deepEqual(visibleBrowserEvents(model, deps).map((event) => event.id), ["shell-a", "shell-b"]);
  model = transitionBrowser(model, { type: "cycle-activity" }, deps).model;
  assert.equal(model.filter, "file");
  assert.equal(model.selectedId, "file-a");
  model = transitionBrowser(model, { type: "cycle-activity" }, deps).model;
  assert.equal(model.filter, "all-recorded");
  assert.deepEqual(visibleBrowserEvents(model, deps).map((event) => event.id), ["life", "shell-a", "file-a", "shell-b"]);
});

test("search navigates matches with wraparound and clear resets projection", () => {
  let model = createBrowserModel(events, deps);
  model = transitionBrowser(model, { type: "set-search", query: "deploy" }, deps).model;
  assert.deepEqual(model.searchMatchIds, ["shell-b"]);
  assert.equal(model.selectedId, "shell-b");
  model = transitionBrowser(model, { type: "set-search", query: "tool" }, deps).model;
  assert.deepEqual(model.searchMatchIds, ["shell-a", "file-a", "shell-b"]);
  model = transitionBrowser(model, { type: "next-match" }, deps).model;
  assert.equal(model.selectedId, "shell-a");
  model = transitionBrowser(model, { type: "previous-match" }, deps).model;
  assert.equal(model.selectedId, "shell-b");
  model = transitionBrowser(model, { type: "clear" }, deps).model;
  assert.equal(model.search, "");
  assert.equal(model.filter, "narrated");
});

test("search matches stay within the active activity view", () => {
  let model = createBrowserModel(events, deps);
  model = transitionBrowser(model, { type: "cycle-activity" }, deps).model;
  assert.equal(model.filter, "shell");
  model = transitionBrowser(model, { type: "set-search", query: "README" }, deps).model;
  assert.deepEqual(model.searchMatchIds, []);
  assert.ok(visibleBrowserEvents(model, deps).some((event) => event.id === model.selectedId));
  model = transitionBrowser(model, { type: "set-search", query: "tool" }, deps).model;
  assert.deepEqual(model.searchMatchIds, ["shell-a", "shell-b"]);
  model = transitionBrowser(model, { type: "cycle-activity" }, deps).model;
  assert.equal(model.filter, "file");
  assert.deepEqual(model.searchMatchIds, ["file-a"]);
  assert.equal(model.selectedId, "file-a");
});

test("detail focus, narrow detail, help, scrolling, reload, and quit are explicit", () => {
  let model = createBrowserModel(events, deps);
  model = transitionBrowser(model, { type: "enter" }, deps, { split: true }).model;
  assert.equal(model.focus, "detail");
  model = transitionBrowser(model, { type: "down" }, deps, { split: true, maxDetailScroll: 3 }).model;
  assert.equal(model.detailScroll, 1);
  model = transitionBrowser(model, { type: "tab" }, deps, { split: true }).model;
  assert.equal(model.focus, "list");
  model = transitionBrowser(model, { type: "enter" }, deps, { split: false }).model;
  assert.equal(model.narrowView, "detail");
  model = transitionBrowser(model, { type: "escape" }, deps, { split: false }).model;
  assert.equal(model.narrowView, "list");
  model = transitionBrowser(model, { type: "help" }, deps).model;
  assert.equal(model.helpVisible, true);
  model = transitionBrowser(model, { type: "escape" }, deps).model;
  assert.equal(model.helpVisible, false);
  assert.equal(transitionBrowser(model, { type: "reload" }, deps).action, "reload");
  assert.equal(transitionBrowser(model, { type: "quit" }, deps).action, "quit");

  model = transitionBrowser(model, { type: "down" }, deps).model;
  model = replaceBrowserEvents(model, [...events, { id: "new", sequence: 5, type: "capture.gap", payload: {} }], deps);
  assert.equal(model.selectedId, "file-a");
});

test("empty browser snapshots remain navigable without synthetic selection", () => {
  const model = createBrowserModel([], deps);
  assert.equal(model.selectedId, undefined);
  assert.deepEqual(visibleBrowserEvents(model, deps), []);
  assert.doesNotThrow(() => transitionBrowser(model, { type: "down" }, deps));
});
