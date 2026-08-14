import stringWidth from "string-width";

import type { AttachStatus } from "./cli.ts";

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
  // Preserve emoji joiners while removing terminal escapes and unsafe controls.
  return value
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\p{Cf}/gu, (character) => character === "\u200d" ? character : "")
    .replace(/\s+/gu, " ")
    .trim();
}

function countLabel(count: number, singular: string, plural = singular): string | undefined {
  return count > 0 ? `${count} ${count === 1 ? singular : plural}` : undefined;
}

export function buildLiveFooterModel(status: AttachStatus): LiveFooterModel {
  const summary = status.captureSummary;
  const captureDetails = [
    countLabel(summary.gaps, "gap", "gaps"),
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

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function bounded(value: string, columns: number): string {
  if (stringWidth(value) <= columns) return value;
  if (columns <= 0) return "";

  const ellipsis = "…";
  const ellipsisWidth = stringWidth(ellipsis);
  if (ellipsisWidth > columns) return "";

  let prefix = "";
  let prefixWidth = 0;
  for (const { segment } of graphemeSegmenter.segment(value)) {
    const segmentWidth = stringWidth(segment);
    if (prefixWidth + segmentWidth + ellipsisWidth > columns) break;
    prefix += segment;
    prefixWidth += segmentWidth;
  }
  return `${prefix}${ellipsis}`;
}

function addTokensWithin(tokens: string[], columns: number): { line: string; dropped: boolean } {
  let line = "";
  let dropped = false;
  for (const token of tokens) {
    const candidate = line ? `${line} · ${token}` : token;
    if (stringWidth(candidate) <= columns) line = candidate;
    else {
      dropped = true;
      break;
    }
  }
  return { line: bounded(line || tokens[0] || "", columns), dropped };
}

export function formatLiveFooter(model: LiveFooterModel, columns: number): string[] {
  const width = Number.isFinite(columns) && columns > 0 ? Math.max(1, Math.trunc(columns)) : 1;
  const state = display(model.state);
  const activity = display(model.activity);
  const evidence = display(model.evidence);
  const capture = display(model.capture);
  const details = model.captureDetails.map(display).filter(Boolean);
  const freshness = display(model.freshness);
  const eventCount = `${Math.max(0, Math.trunc(model.eventCount) || 0)} ev`;

  if (width < 40) {
    if (stringWidth(state) > width) return [bounded(state, width)];

    const tokenSeparator = " · ";
    let line = state;
    const activityBudget = width - stringWidth(state) - stringWidth(tokenSeparator);
    if (activityBudget > 0) {
      line += `${tokenSeparator}${bounded(activity, activityBudget)}`;
    }

    for (const token of [evidence, capture, freshness, eventCount]) {
      const candidate = `${line}${tokenSeparator}${token}`;
      if (stringWidth(candidate) > width) break;
      line = candidate;
    }
    return [line];
  }

  const separator = "─".repeat(width);
  const activityLine = bounded(`${state} · ${activity}`, width);
  const evidenceLine = bounded(evidence, width);

  if (width >= 72) {
    const essentialSummary = `${capture} · ${freshness}`;
    if (stringWidth(essentialSummary) > width) {
      return [separator, activityLine, evidenceLine, bounded(essentialSummary, width)];
    }

    const includedDetails: string[] = [];
    for (const detail of details) {
      const candidate = [capture, ...includedDetails, detail, freshness].join(" · ");
      if (stringWidth(candidate) > width) break;
      includedDetails.push(detail);
    }
    const summary = [capture, ...includedDetails, freshness];
    const withEventCount = [...summary, eventCount].join(" · ");
    return [separator, activityLine, evidenceLine, stringWidth(withEventCount) <= width ? withEventCount : summary.join(" · ")];
  }

  const captureLine = addTokensWithin([capture, ...details], width);
  // If warning details already overflowed, preserve freshness and discard the
  // lowest-priority event count before attempting to show more metadata.
  const trailing = addTokensWithin(captureLine.dropped ? [freshness] : [freshness, eventCount], width).line;
  return [separator, activityLine, evidenceLine, captureLine.line, trailing];
}
