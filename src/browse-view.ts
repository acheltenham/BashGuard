import stringWidth from "string-width";

import { visibleBrowserEvents, type BrowserDependencies, type BrowserEvent, type BrowserModel } from "./browse-model.ts";

export type BrowserDimensions = { width: number; height: number };
export type BrowserProjectors = {
  timeline(event: BrowserEvent): string;
  detail(event: BrowserEvent): string;
};
export type BrowserFrameContext = {
  sessionId: string;
  repository?: string;
  snapshotTime: string;
};

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function truncate(text: string, width: number): string {
  const clean = text.replace(/[\r\n]+/g, " ");
  if (width <= 0) return "";
  if (stringWidth(clean) <= width) return clean;
  if (width === 1) return "…";
  let result = "";
  for (const segment of graphemes.segment(clean)) {
    if (stringWidth(result + segment.segment + "…") > width) break;
    result += segment.segment;
  }
  return result + "…";
}

function fit(text: string, width: number): string {
  const bounded = truncate(text, width);
  return bounded + " ".repeat(Math.max(0, width - stringWidth(bounded)));
}

function selectedEvent(model: BrowserModel): BrowserEvent | undefined {
  return model.events.find((event) => event.id === model.selectedId);
}

function projectedListRows(model: BrowserModel, dependencies: BrowserDependencies, projectors: BrowserProjectors, height: number, width: number): string[] {
  const visible = visibleBrowserEvents(model, dependencies);
  const selected = Math.max(0, visible.findIndex((event) => event.id === model.selectedId));
  const start = Math.max(0, Math.min(Math.max(0, visible.length - height), selected - Math.floor(height / 2)));
  return Array.from({ length: height }, (_, offset) => {
    const event = visible[start + offset];
    if (!event) return " ".repeat(width);
    const projected = projectors.timeline(event) || `${event.sequence} ${event.id} ${event.type}`;
    return fit(`${event.id === model.selectedId ? "▸" : " "} ${projected}`, width);
  });
}

function detailRows(model: BrowserModel, projectors: BrowserProjectors, height: number, width: number): string[] {
  const event = selectedEvent(model);
  const lines = event ? projectors.detail(event).split("\n") : ["No event selected"];
  return Array.from({ length: height }, (_, offset) => fit(lines[model.detailScroll + offset] ?? "", width));
}

function helpRows(height: number, width: number): string[] {
  const help = [
    "Help",
    "↑/k previous · ↓/j next",
    "PgUp/PgDn page · g/G first/last",
    "Enter detail · Tab focus · Esc back",
    "/ search · n/N matches · a activity",
    "c clear · r reload · ? help · q quit",
  ];
  return Array.from({ length: height }, (_, index) => fit(help[index] ?? "", width));
}

export function renderBrowserFrame(
  model: BrowserModel,
  dimensions: BrowserDimensions,
  dependencies: BrowserDependencies,
  projectors: BrowserProjectors,
  context: BrowserFrameContext,
): string[] {
  const width = Math.max(1, Math.floor(dimensions.width));
  const height = Math.max(8, Math.floor(dimensions.height));
  const split = width >= 80;
  const bodyHeight = height - 3;
  const repository = context.repository ? ` · ${context.repository}` : "";
  const header = fit(`BashGuard · browse    ${context.sessionId}${repository} · snapshot ${context.snapshotTime}`, width);
  const narrated = model.events.filter(dependencies.isNarrated).length;
  const search = model.search ? ` · /${model.search}/` : "";
  const status = fit(`${visibleBrowserEvents(model, dependencies).length}/${narrated} narrated · ${model.events.length} recorded · ${model.filter}${search} · ? help · q quit`, width);

  if (model.helpVisible) {
    return [header, "─".repeat(width), ...helpRows(bodyHeight, width), status];
  }

  if (split) {
    const detailWidth = Math.max(36, Math.min(72, Math.round(width * 0.45)));
    const listWidth = width - detailWidth - 3;
    const divider = `${"─".repeat(listWidth)}─┬${"─".repeat(detailWidth + 1)}`;
    const list = projectedListRows(model, dependencies, projectors, bodyHeight, listWidth);
    const detail = detailRows(model, projectors, bodyHeight, detailWidth);
    const body = list.map((line, index) => `${line} │ ${detail[index]}`);
    return [header, divider, ...body, status];
  }

  const divider = "─".repeat(width);
  const body = model.narrowView === "detail"
    ? detailRows(model, projectors, bodyHeight, width)
    : projectedListRows(model, dependencies, projectors, bodyHeight, width);
  return [header, divider, ...body, status];
}
