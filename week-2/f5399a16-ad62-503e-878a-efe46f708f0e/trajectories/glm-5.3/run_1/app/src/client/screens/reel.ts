// The reel: the kind filter as a radio group in the URL, the work grid and
// the client strip.

import { el, type ScreenContext, heading, field } from "../lib/ui";

const KINDS: { value: string | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "boards", label: "Boards" },
  { value: "reels", label: "Reels" },
  { value: "pitchFrames", label: "Pitch frames" },
];

const WORK: Record<string, { title: string; kind: string }[]> = {
  boards: [
    { title: "Ferry at First Light", kind: "boards" },
    { title: "The Long Bakery Shift", kind: "boards" },
    { title: "Cold Snap Cola", kind: "boards" },
  ],
  reels: [
    { title: "Night Tram", kind: "reels" },
    { title: "Harbour Swimmers", kind: "reels" },
    { title: "Paper Kites", kind: "reels" },
  ],
  pitchFrames: [
    { title: "Rainline Coats", kind: "pitchFrames" },
    { title: "Orchard Bank", kind: "pitchFrames" },
    { title: "Salt and Thyme", kind: "pitchFrames" },
  ],
};

const CLIENTS = [
  "Tidewater Soda",
  "Kestrel Air",
  "Oak & Ember Bakers",
  "Northquay Bank",
  "Lumen Bicycles",
  "Saffron Street Foods",
];

export async function buildReel(ctx: ScreenContext, query: URLSearchParams): Promise<{ heading: HTMLElement; body: HTMLElement }> {
  const h = heading(["Work on the reel"], ctx.announcer);
  const kind = query.get("kind");
  const group = el("div", { role: "radiogroup", "aria-label": "Kind of work", class: "kind-filter" });
  const grid = el("div", { class: "work-grid", id: "work-grid" });
  const items: Record<string, HTMLElement> = {};

  const renderGrid = (): void => {
    const kept = WORK[kind ?? ""] ?? [];
    const all = kind === null;
    const list = all ? [...WORK.boards!, ...WORK.reels!, ...WORK.pitchFrames!] : kept;
    for (const work of list) {
      const node = items[work.title];
      if (node === undefined) {
        const item = el("div", { class: "work-item", "data-part": "work" }, el("p", {}, work.title));
        items[work.title] = item;
      }
      if (!grid.contains(items[work.title]!)) {
        grid.append(items[work.title]!);
      }
    }
    for (const child of Array.from(grid.children)) {
      const title = (child as HTMLElement).textContent ?? "";
      if (!list.some((w) => w.title === title)) {
        grid.removeChild(child);
      }
    }
  };

  for (const option of KINDS) {
    const radio = field("input", { type: "radio", name: "kind", ...(option.value === null ? {} : { value: option.value }) }) as HTMLInputElement;
    radio.setAttribute("role", "radio");
    radio.id = `kind-${option.value ?? "all"}`;
    if ((option.value === null && kind === null) || (option.value !== null && option.value === kind)) {
      radio.checked = true;
    }
    radio.addEventListener("change", () => {
      const next = option.value === null ? "/reel" : `/reel?kind=${option.value}`;
      void ctx.router.go(next);
    });
    const label = el("label", { for: radio.id }, option.label);
    label.style.minHeight = "44px";
    label.style.minWidth = "44px";
    label.style.display = "inline-flex";
    label.style.alignItems = "center";
    group.append(el("div", { class: "kind-option" }, radio, label));
  }
  renderGrid();

  const strip = el("div", { class: "client-strip", "data-part": "client-strip" });
  const inner = el("div", { class: "client-strip-inner" });
  for (const name of CLIENTS) {
    inner.append(el("span", { class: "client-name" }, name));
  }
  strip.append(inner);
  const clients = el("section", { class: "clients", "aria-label": "Clients", role: "region", "data-part": "client-strip" }, strip);

  const body = el("main", { class: "reel" }, h, group, grid, clients);
  return { heading: h, body };
}
