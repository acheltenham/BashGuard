export type BrowserEvent = {
  id: string;
  sequence: number;
  type: string;
  toolName?: string;
  payload?: Record<string, unknown>;
};

export type BrowserDependencies = {
  activities: string[];
  isNarrated(event: BrowserEvent): boolean;
  matchesActivity(event: BrowserEvent, activity: string): boolean;
  matchesSearch(event: BrowserEvent, query: string): boolean;
};

export type BrowserModel = {
  events: BrowserEvent[];
  selectedId?: string;
  filter: "narrated" | "all-recorded" | string;
  search: string;
  searchMatchIds: string[];
  focus: "list" | "detail";
  narrowView: "list" | "detail";
  detailScroll: number;
  helpVisible: boolean;
};

export type BrowserInput =
  | { type: "up" | "down" | "page-up" | "page-down" | "home" | "end" }
  | { type: "enter" | "tab" | "escape" | "cycle-activity" | "clear" | "next-match" | "previous-match" | "help" | "reload" | "quit" }
  | { type: "set-search"; query: string };

export type BrowserTransitionOptions = {
  pageSize?: number;
  split?: boolean;
  maxDetailScroll?: number;
};

export function visibleBrowserEvents(model: BrowserModel, dependencies: BrowserDependencies): BrowserEvent[] {
  if (model.filter === "all-recorded") return model.events;
  if (model.filter === "narrated") return model.events.filter(dependencies.isNarrated);
  return model.events.filter((event) => dependencies.matchesActivity(event, model.filter));
}

function matchIds(events: BrowserEvent[], query: string, dependencies: BrowserDependencies): string[] {
  if (!query) return [];
  return events.filter((event) => dependencies.matchesSearch(event, query)).map((event) => event.id);
}

function validSelection(model: BrowserModel, dependencies: BrowserDependencies, preferred = model.selectedId): string | undefined {
  const visible = visibleBrowserEvents(model, dependencies);
  return preferred && visible.some((event) => event.id === preferred) ? preferred : visible[0]?.id;
}

export function createBrowserModel(events: BrowserEvent[], dependencies: BrowserDependencies): BrowserModel {
  const model: BrowserModel = {
    events: [...events],
    filter: "narrated",
    search: "",
    searchMatchIds: [],
    focus: "list",
    narrowView: "list",
    detailScroll: 0,
    helpVisible: false,
  };
  return { ...model, selectedId: validSelection(model, dependencies) };
}

function moveSelection(model: BrowserModel, dependencies: BrowserDependencies, offset: number): BrowserModel {
  const visible = visibleBrowserEvents(model, dependencies);
  if (visible.length === 0) return model;
  const current = Math.max(0, visible.findIndex((event) => event.id === model.selectedId));
  const next = Math.max(0, Math.min(visible.length - 1, current + offset));
  return { ...model, selectedId: visible[next]?.id, detailScroll: 0 };
}

function cycleMatch(model: BrowserModel, direction: number): BrowserModel {
  if (model.searchMatchIds.length === 0) return model;
  const current = model.searchMatchIds.indexOf(model.selectedId ?? "");
  const base = current < 0 ? (direction > 0 ? -1 : 0) : current;
  const next = (base + direction + model.searchMatchIds.length) % model.searchMatchIds.length;
  return { ...model, selectedId: model.searchMatchIds[next], detailScroll: 0 };
}

export function transitionBrowser(
  model: BrowserModel,
  input: BrowserInput,
  dependencies: BrowserDependencies,
  options: BrowserTransitionOptions = {},
): { model: BrowserModel; action?: "reload" | "quit" } {
  if (input.type === "quit") return { model, action: "quit" };
  if (input.type === "reload") return { model, action: "reload" };
  if (input.type === "help") return { model: { ...model, helpVisible: !model.helpVisible } };
  if (input.type === "escape") {
    if (model.helpVisible) return { model: { ...model, helpVisible: false } };
    if (model.narrowView === "detail") return { model: { ...model, narrowView: "list", detailScroll: 0 } };
    if (model.search) return { model: { ...model, search: "", searchMatchIds: [] } };
    return { model };
  }
  if (input.type === "clear") {
    const cleared = { ...model, filter: "narrated", search: "", searchMatchIds: [], detailScroll: 0 };
    return { model: { ...cleared, selectedId: validSelection(cleared, dependencies) } };
  }
  if (input.type === "set-search") {
    const ids = matchIds(model.events, input.query, dependencies);
    const selectedId = model.selectedId && ids.includes(model.selectedId) ? model.selectedId : ids[0] ?? model.selectedId;
    return { model: { ...model, search: input.query, searchMatchIds: ids, selectedId, detailScroll: 0 } };
  }
  if (input.type === "next-match") return { model: cycleMatch(model, 1) };
  if (input.type === "previous-match") return { model: cycleMatch(model, -1) };
  if (input.type === "cycle-activity") {
    const filters = ["narrated", ...dependencies.activities, "all-recorded"];
    const index = Math.max(0, filters.indexOf(model.filter));
    const cycled = { ...model, filter: filters[(index + 1) % filters.length]!, detailScroll: 0 };
    return { model: { ...cycled, selectedId: validSelection(cycled, dependencies) } };
  }
  if (input.type === "enter") {
    return options.split
      ? { model: { ...model, focus: "detail", detailScroll: 0 } }
      : { model: { ...model, narrowView: "detail", detailScroll: 0 } };
  }
  if (input.type === "tab" && options.split) {
    return { model: { ...model, focus: model.focus === "list" ? "detail" : "list" } };
  }
  if (model.focus === "detail" && options.split && ["up", "down", "page-up", "page-down"].includes(input.type)) {
    const amount = input.type === "up" ? -1 : input.type === "down" ? 1 : input.type === "page-up" ? -(options.pageSize ?? 10) : options.pageSize ?? 10;
    return { model: { ...model, detailScroll: Math.max(0, Math.min(options.maxDetailScroll ?? Number.MAX_SAFE_INTEGER, model.detailScroll + amount)) } };
  }
  const page = Math.max(1, options.pageSize ?? 10);
  if (input.type === "up") return { model: moveSelection(model, dependencies, -1) };
  if (input.type === "down") return { model: moveSelection(model, dependencies, 1) };
  if (input.type === "page-up") return { model: moveSelection(model, dependencies, -page) };
  if (input.type === "page-down") return { model: moveSelection(model, dependencies, page) };
  if (input.type === "home") return { model: moveSelection(model, dependencies, -Number.MAX_SAFE_INTEGER) };
  if (input.type === "end") return { model: moveSelection(model, dependencies, Number.MAX_SAFE_INTEGER) };
  return { model };
}

export function replaceBrowserEvents(model: BrowserModel, events: BrowserEvent[], dependencies: BrowserDependencies): BrowserModel {
  const replaced = {
    ...model,
    events: [...events],
    searchMatchIds: matchIds(events, model.search, dependencies),
    detailScroll: 0,
  };
  return { ...replaced, selectedId: validSelection(replaced, dependencies, model.selectedId) };
}
