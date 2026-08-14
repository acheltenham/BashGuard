import type { AttachCaptureSummary, AttachStatus } from "./cli.ts";
import { singleLineDisplay } from "./session-format.ts";

export type LiveFooterModel = {
  state: "ACTIVE" | "DONE";
  activity: string;
  evidence: "recorded" | "awaiting completion evidence" | "no activity evidence";
  capture: "capture ok" | "capture partial" | "capture unknown";
  captureDetails: string[];
  eventCount: number;
  freshness: string;
};

function display(value: string): string {
  // Remove terminal escape sequences before singleLineDisplay removes remaining controls.
  return singleLineDisplay(value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/gu, ""));
}

function captureSummary(status: AttachStatus): AttachCaptureSummary {
  if (status.captureSummary) return status.captureSummary;
  if (status.capture === "No recorded capture limitations") {
    return { state: "ok", gaps: 0, missing: 0, redacted: 0, truncated: 0 };
  }
  if (status.capture === "No capture metadata recorded") {
    return { state: "unknown", gaps: 0, missing: 0, redacted: 0, truncated: 0 };
  }

  // Compatibility for AttachStatus values serialized before captureSummary was
  // available. New buildAttachStatus results use the structured path above.
  const count = (pattern: RegExp): number => Number(pattern.exec(status.capture)?.[1] ?? 0);
  return {
    state: "partial",
    gaps: count(/(?:^| · )(\d+) capture gaps?(?: · |$)/u),
    missing: count(/(?:^| · )(\d+) events? with missing fields(?: · |$)/u),
    redacted: count(/(?:^| · )(\d+) redacted events?(?: · |$)/u),
    truncated: count(/(?:^| · )(\d+) truncated events?(?: · |$)/u),
  };
}

function countLabel(count: number, label: string): string | undefined {
  return count > 0 ? `${count} ${label}` : undefined;
}

export function buildLiveFooterModel(status: AttachStatus): LiveFooterModel {
  const summary = captureSummary(status);
  const captureDetails = [
    countLabel(summary.gaps, "gap"),
    countLabel(summary.truncated, "truncated"),
    countLabel(summary.missing, "missing"),
    countLabel(summary.redacted, "redacted"),
  ].filter((detail): detail is string => detail !== undefined);

  return {
    state: status.state === "active" ? "ACTIVE" : "DONE",
    activity: display(status.activity) || "No narrated activity recorded",
    evidence: status.evidence === "request recorded; completion not recorded yet"
      ? "awaiting completion evidence"
      : status.evidence === "recorded event"
        ? "recorded"
        : "no activity evidence",
    capture: summary.state === "ok" ? "capture ok" : summary.state === "partial" ? "capture partial" : "capture unknown",
    captureDetails,
    eventCount: Number.isFinite(status.eventCount) ? Math.max(0, Math.trunc(status.eventCount)) : 0,
    freshness: display(status.lastObserved) || "unknown",
  };
}

/**
 * Footer width is approximated with JavaScript string length. This intentionally
 * avoids a display-width dependency for now, so some wide/combining glyphs may
 * occupy a different number of terminal cells than their measured length.
 */
function bounded(value: string, columns: number): string {
  if (value.length <= columns) return value;
  if (columns <= 0) return "";
  if (columns === 1) return "…";
  let prefix = value.slice(0, columns - 1);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix}…`;
}

function addTokensWithin(tokens: string[], columns: number): { line: string; dropped: boolean } {
  let line = "";
  let dropped = false;
  for (const token of tokens) {
    const candidate = line ? `${line} · ${token}` : token;
    if (candidate.length <= columns) line = candidate;
    else dropped = true;
  }
  return { line: bounded(line || tokens[0] || "", columns), dropped };
}

export function formatLiveFooter(model: LiveFooterModel, columns: number): string[] {
  const width = Math.max(1, Math.trunc(columns) || 1);
  const state = display(model.state);
  const activity = display(model.activity);
  const evidence = display(model.evidence);
  const capture = display(model.capture);
  const details = model.captureDetails.map(display).filter(Boolean);
  const freshness = display(model.freshness);
  const eventCount = `${Math.max(0, Math.trunc(model.eventCount) || 0)} ev`;

  if (width < 40) {
    let line = "";
    for (const token of [state, activity, evidence, capture, freshness, eventCount]) {
      const candidate = line ? `${line} · ${token}` : token;
      if (candidate.length <= width) line = candidate;
      else return [bounded(candidate, width)];
    }
    return [line];
  }

  const separator = "─".repeat(width);
  const activityLine = bounded(`${state} · ${activity}`, width);
  const evidenceLine = bounded(evidence, width);

  if (width >= 72) {
    const summary = addTokensWithin([capture, ...details, freshness, eventCount], width).line;
    return [separator, activityLine, evidenceLine, summary];
  }

  const captureLine = addTokensWithin([capture, ...details], width);
  // If warning details already overflowed, preserve freshness and discard the
  // lowest-priority event count before attempting to show more metadata.
  const trailing = addTokensWithin(captureLine.dropped ? [freshness] : [freshness, eventCount], width).line;
  return [separator, activityLine, evidenceLine, captureLine.line, trailing];
}
