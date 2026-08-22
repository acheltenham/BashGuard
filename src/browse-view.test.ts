import assert from "node:assert/strict";
import stringWidth from "string-width";
import test from "node:test";

import { createBrowserModel, transitionBrowser, type BrowserEvent } from "./browse-model.ts";
import { renderBrowserFrame } from "./browse-view.ts";

const events: BrowserEvent[] = Array.from({ length: 12 }, (_, index) => ({
  id: `event-${index + 1}`,
  sequence: index + 1,
  type: index === 0 ? "session.started" : "tool.requested",
  toolName: index % 2 ? "bash" : "read",
  payload: { text: index === 5 ? "emoji 👩🏽‍💻 漢字 é" : `payload ${index + 1}` },
}));
const deps = {
  activities: ["shell", "file"],
  isNarrated: (event: BrowserEvent) => event.id !== "event-1",
  matchesActivity: (event: BrowserEvent, activity: string) => activity === "shell" ? event.toolName === "bash" : event.toolName === "read",
  matchesSearch: (event: BrowserEvent, query: string) => JSON.stringify(event).toLowerCase().includes(query.toLowerCase()),
};
const projectors = {
  timeline: (event: BrowserEvent) => `${event.sequence} ${event.id} ${String(event.payload?.text ?? event.type)}`,
  narrative: (event: BrowserEvent) => String(event.payload?.text ?? event.type),
  detail: (event: BrowserEvent) => `Sequence ${event.sequence}\nEvent ID ${event.id}\nType ${event.type}\nPayload\n${JSON.stringify(event.payload, null, 2)}`,
};

function assertBounded(lines: string[], width: number, height: number): void {
  assert.equal(lines.length, height);
  for (const line of lines) assert.ok(stringWidth(line) <= width, `${stringWidth(line)} > ${width}: ${JSON.stringify(line)}`);
}

test("80 columns renders split panes while 79 renders a single list pane", () => {
  const model = createBrowserModel(events, deps);
  const split = renderBrowserFrame(model, { width: 80, height: 12 }, deps, projectors, { sessionId: "session-1", repository: "repo", snapshotTime: "19:45:03" });
  assertBounded(split, 80, 12);
  assert.match(split[1]!, /┬/);
  assert.ok(split.slice(2, -1).some((line) => line.includes(" │ ")));
  assert.ok(split.some((line) => line.includes("Sequence")));

  const narrow = renderBrowserFrame(model, { width: 79, height: 12 }, deps, projectors, { sessionId: "session-1", snapshotTime: "19:45:03" });
  assertBounded(narrow, 79, 12);
  assert.doesNotMatch(narrow[1]!, /┬/);
  assert.ok(narrow.some((line) => line.startsWith("▸")));
});

test("single-pane Enter shows detail and status always exposes counts and filters", () => {
  let model = createBrowserModel(events, deps);
  model = transitionBrowser(model, { type: "enter" }, deps, { split: false }).model;
  model = transitionBrowser(model, { type: "set-search", query: "payload" }, deps).model;
  const frame = renderBrowserFrame(model, { width: 70, height: 10 }, deps, projectors, { sessionId: "session-1", snapshotTime: "19:45:03" });
  assertBounded(frame, 70, 10);
  assert.ok(frame.some((line) => line.includes("Event ID")));
  assert.match(frame.at(-1)!, /11 narrated · 12 recorded · narrated · \/payload\//);
});

test("rows follow selection and retain grapheme-safe bounds under pressure", () => {
  let model = createBrowserModel(events, deps);
  for (let index = 0; index < 8; index++) model = transitionBrowser(model, { type: "down" }, deps).model;
  const frame = renderBrowserFrame(model, { width: 39, height: 8 }, deps, projectors, { sessionId: "session-1", snapshotTime: "19:45:03" });
  assertBounded(frame, 39, 8);
  assert.ok(frame.some((line) => line.startsWith("▸") && line.includes("event-10")));
  assert.doesNotMatch(frame.join("\n"), /\uFFFD/);
});

test("single-pane rows drop event ID and timestamp before truncating narration", () => {
  const compressedProjectors = {
    ...projectors,
    timeline: () => `1 ${"long-event-id".repeat(8)} 12:00:00 essential narration`,
    narrative: () => "essential narration",
  };
  const frame = renderBrowserFrame(createBrowserModel(events, deps), { width: 79, height: 8 }, deps, compressedProjectors, { sessionId: "session-1", snapshotTime: "19:45:03" });
  assert.ok(frame.some((line) => line.includes("essential narration")));
  assert.ok(frame.every((line) => !line.includes("long-event-id")));
});

test("help replaces the body without changing frame dimensions", () => {
  let model = createBrowserModel(events, deps);
  model = transitionBrowser(model, { type: "help" }, deps).model;
  const frame = renderBrowserFrame(model, { width: 80, height: 8 }, deps, projectors, { sessionId: "session-1", snapshotTime: "19:45:03" });
  assertBounded(frame, 80, 8);
  assert.ok(frame.some((line) => line.includes("↑/k previous")));
  assert.ok(frame.some((line) => line.includes("q quit")));
});
