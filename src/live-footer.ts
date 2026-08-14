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
  write(chunk: string): boolean;
  once(event: "drain", listener: () => void): unknown;
  once(event: "error", listener: (error: unknown) => void): unknown;
  once(event: "close", listener: () => void): unknown;
  removeListener(event: "drain", listener: () => void): unknown;
  removeListener(event: "error", listener: (error: unknown) => void): unknown;
  removeListener(event: "close", listener: () => void): unknown;
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
 * Sequenced terminal adapter for a footer rendered at the current cursor.
 * Process listeners and lifecycle policy intentionally remain with the caller.
 */
export class LiveFooterController {
  readonly #output: StructuralWritable;
  readonly #formatter: LiveFooterFormatter;
  readonly #clock: () => number;
  readonly #width: () => number;
  #tail: Promise<void> = Promise.resolve();
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

  render(model: LiveFooterModel): Promise<void> {
    const snapshot = copyModel(model);
    return this.#enqueue(async () => {
      if (this.#cleaned) return;
      const width = normalizeWidth(this.#width());
      const now = this.#clock();
      const changed = !modelsEqual(this.#model, snapshot);
      const widthChanged = this.#lastRenderWidth !== width;
      const freshnessDue = this.#lastRenderTime === undefined
        || now < this.#lastRenderTime
        || now - this.#lastRenderTime >= LIVE_FOOTER_REFRESH_MS;
      if (!changed && !widthChanged && !freshnessDue) return;
      await this.#redraw(snapshot, width, now);
    });
  }

  refresh(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#cleaned || this.#model === undefined) return;
      const width = normalizeWidth(this.#width());
      const now = this.#clock();
      const widthChanged = this.#lastRenderWidth !== width;
      const freshnessDue = this.#lastRenderTime === undefined
        || now < this.#lastRenderTime
        || now - this.#lastRenderTime >= LIVE_FOOTER_REFRESH_MS;
      if (!widthChanged && !freshnessDue) return;
      await this.#redraw(this.#model, width, now);
    });
  }

  writeTimeline(payload: string): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#cleaned) return;
      const width = normalizeWidth(this.#width());
      const now = this.#clock();
      const model = this.#model === undefined ? undefined : copyModel(this.#model);
      const lines = model === undefined ? undefined : this.#formatter(model, width);

      await this.#clearRendered();
      await this.#write(`${payload.replace(/\r\n|\r|\n/gu, "\r\n")}\r\n`);
      if (model !== undefined && lines !== undefined) {
        await this.#writeFooter(lines);
        this.#lastRenderTime = now;
        this.#lastRenderWidth = width;
      }
    });
  }

  resize(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#cleaned || this.#model === undefined) return;
      const width = normalizeWidth(this.#width());
      if (width === this.#lastRenderWidth) return;
      await this.#redraw(this.#model, width, this.#clock());
    });
  }

  cleanup(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#cleaned) return;
      await this.#clearRendered();
      await this.#write("\r\n");
      this.#cleaned = true;
    });
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async #redraw(model: LiveFooterModel, width: number, now: number): Promise<void> {
    const snapshot = copyModel(model);
    const lines = this.#formatter(snapshot, width);
    await this.#clearRendered();
    await this.#writeFooter(lines);
    this.#model = snapshot;
    this.#lastRenderTime = now;
    this.#lastRenderWidth = width;
  }

  async #clearRendered(): Promise<void> {
    const sequence = footerClearSequence(this.#renderedLineCount);
    if (!sequence) return;
    await this.#write(sequence);
    this.#renderedLineCount = 0;
    this.#lastRenderTime = undefined;
  }

  async #writeFooter(lines: readonly string[]): Promise<void> {
    if (lines.length === 0) {
      this.#renderedLineCount = 0;
      return;
    }
    await this.#write(lines.join("\r\n"));
    this.#renderedLineCount = lines.length;
  }

  #write(chunk: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        this.#output.removeListener("drain", onDrain);
        this.#output.removeListener("error", onError);
        this.#output.removeListener("close", onClose);
        if (error === undefined) resolve();
        else reject(error);
      };
      const onDrain = () => finish();
      const onError = (error: unknown) => finish(error);
      const onClose = () => finish(Object.assign(new Error("Writable closed before drain"), {
        code: "ERR_STREAM_PREMATURE_CLOSE",
      }));

      this.#output.once("drain", onDrain);
      this.#output.once("error", onError);
      this.#output.once("close", onClose);
      try {
        if (this.#output.write(chunk)) finish();
      } catch (error) {
        finish(error);
      }
    });
  }
}

export function createLiveFooterController(options: LiveFooterControllerOptions): LiveFooterController {
  return new LiveFooterController(options);
}
