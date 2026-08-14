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
  const width = normalizeWidth(columns);
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

export const ANSI_CARRIAGE_RETURN = "\r";
export const ANSI_ERASE_LINE = "\u001b[2K";
export const ANSI_CURSOR_UP = "\u001b[1A";
export const ANSI_CLEAR_LINE = `${ANSI_CARRIAGE_RETURN}${ANSI_ERASE_LINE}`;
export const LIVE_FOOTER_REFRESH_MS = 1_000;

export type StructuralWritable = {
  write(chunk: string): unknown;
};

export type LiveFooterFormatter = (model: LiveFooterModel, width: number) => readonly string[];

export type LiveFooterControllerOptions = {
  output: StructuralWritable;
  formatter?: LiveFooterFormatter;
  clock?: () => number;
  width: () => number;
};

function normalizeWidth(width: number): number {
  return Number.isFinite(width) && width > 0 ? Math.max(1, Math.trunc(width)) : 1;
}

function copyModel(model: LiveFooterModel): LiveFooterModel {
  return { ...model, captureDetails: [...model.captureDetails] };
}

function modelsEqual(left: LiveFooterModel | undefined, right: LiveFooterModel): boolean {
  return left !== undefined
    && left.state === right.state
    && left.activity === right.activity
    && left.evidence === right.evidence
    && left.capture === right.capture
    && left.eventCount === right.eventCount
    && left.freshness === right.freshness
    && left.captureDetails.length === right.captureDetails.length
    && left.captureDetails.every((detail, index) => detail === right.captureDetails[index]);
}

export function footerClearSequence(lineCount: number): string {
  const count = Number.isFinite(lineCount) ? Math.max(0, Math.trunc(lineCount)) : 0;
  if (count === 0) return "";
  return ANSI_CLEAR_LINE + `${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}`.repeat(count - 1);
}

/**
 * Synchronous terminal adapter for a footer rendered at the current cursor.
 * Process listeners and lifecycle policy intentionally remain with the caller.
 */
export class LiveFooterController {
  readonly #output: StructuralWritable;
  readonly #formatter: LiveFooterFormatter;
  readonly #clock: () => number;
  readonly #width: () => number;
  #model: LiveFooterModel | undefined;
  #renderedLineCount = 0;
  #lastRenderTime: number | undefined;
  #lastRenderWidth: number | undefined;
  #cleaned = false;

  constructor(options: LiveFooterControllerOptions) {
    this.#output = options.output;
    this.#formatter = options.formatter ?? formatLiveFooter;
    this.#clock = options.clock ?? Date.now;
    this.#width = options.width;
  }

  get model(): LiveFooterModel | undefined {
    return this.#model === undefined ? undefined : copyModel(this.#model);
  }

  get renderedLineCount(): number {
    return this.#renderedLineCount;
  }

  get lastRenderTime(): number | undefined {
    return this.#lastRenderTime;
  }

  get lastRenderWidth(): number | undefined {
    return this.#lastRenderWidth;
  }

  render(model: LiveFooterModel): void {
    if (this.#cleaned) return;
    const width = normalizeWidth(this.#width());
    const now = this.#clock();
    const changed = !modelsEqual(this.#model, model);
    const widthChanged = this.#lastRenderWidth !== width;
    const freshnessDue = this.#lastRenderTime === undefined || now - this.#lastRenderTime >= LIVE_FOOTER_REFRESH_MS;
    if (!changed && !widthChanged && !freshnessDue) return;
    this.#redraw(model, width, now);
  }

  writeTimeline(payload: string): void {
    if (this.#cleaned) return;
    const width = normalizeWidth(this.#width());
    const now = this.#clock();
    const lines = this.#model === undefined ? undefined : this.#formatter(this.#model, width);

    this.#clearRendered();
    this.#output.write(`${payload}\n`);
    if (this.#model !== undefined && lines !== undefined) {
      this.#writeFooter(lines);
      this.#lastRenderTime = now;
      this.#lastRenderWidth = width;
    }
  }

  resize(): void {
    if (this.#cleaned || this.#model === undefined) return;
    const width = normalizeWidth(this.#width());
    if (width === this.#lastRenderWidth) return;
    this.#redraw(this.#model, width, this.#clock());
  }

  cleanup(): void {
    if (this.#cleaned) return;
    this.#cleaned = true;
    this.#clearRendered();
    this.#output.write("\n");
  }

  #redraw(model: LiveFooterModel, width: number, now: number): void {
    const snapshot = copyModel(model);
    const lines = this.#formatter(snapshot, width);
    this.#clearRendered();
    this.#writeFooter(lines);
    this.#model = snapshot;
    this.#lastRenderTime = now;
    this.#lastRenderWidth = width;
  }

  #clearRendered(): void {
    const sequence = footerClearSequence(this.#renderedLineCount);
    if (sequence) this.#output.write(sequence);
    this.#renderedLineCount = 0;
  }

  #writeFooter(lines: readonly string[]): void {
    if (lines.length === 0) return;
    this.#output.write(lines.join("\n"));
    this.#renderedLineCount = lines.length;
  }
}

export function createLiveFooterController(options: LiveFooterControllerOptions): LiveFooterController {
  return new LiveFooterController(options);
}
