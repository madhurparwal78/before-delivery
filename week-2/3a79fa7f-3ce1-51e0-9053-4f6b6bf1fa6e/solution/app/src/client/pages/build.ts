// The configurator /build and /build/<code> (brief: Configurator, Interactions/Configurator): options from the
// catalog's fits and stock, every amount from the server's quote (newest change wins), the address mirrors the
// build and the view, and the ride time counts to each settled value.
import { api } from "../api.ts";
import { CURVES, h, reducedMotion, replace, tween, uid } from "../dom.ts";
import { busy } from "../forms.ts";
import { boot } from "../boot.ts";
import { price } from "../format.ts";
import { icon } from "../icons.ts";
import { openCartDrawer } from "../layout.ts";
import type { PageContext } from "../router.ts";
import { announce, type Cart } from "../state.ts";
import { SLOT_NAMES, type BoardPackage, type Build, type Catalog, type Component, type Slot } from "../catalog.ts";
import { financingLine, gauge, lowestMonthly, onward, pageHead } from "../ui.ts";
import { parseView } from "../viewer/camera.ts";
import { hue } from "../viewer/parts.ts";
import { BoardViewer, viewerBuild } from "../viewer/viewer.ts";

interface Picks {
  board_sku: string;
  wing: string;
  mast: string;
  propulsion: string;
  battery: string;
  controller: string;
  spares: number;
  rider_kg: number;
  gear: number;
}

const SLOT_KEYS = SLOT_NAMES.map(([slot]) => slot);
const RIDER = { min: 50, max: 120, step: 5, standard: 80 };
const GEAR = { min: 1, max: 10, step: 1, standard: 5 };
const RIDE_COUNT_MS = 400;

/** A whole number from the address within the slider's range and steps, else the slider's standard value. */
function onScale(text: string | null, scale: typeof RIDER): number {
  const n = Number(text);
  return text !== null && Number.isInteger(n) && n >= scale.min && n <= scale.max && (n - scale.min) % scale.step === 0 ? n : scale.standard;
}

function picksFromQuery(q: URLSearchParams, catalog: Catalog): Picks {
  const board = catalog.boards.find((b) => b.sku === q.get("board") && b.in_stock) ?? catalog.boards.find((b) => b.sku === "DR-49")!;
  const picks: Picks = { board_sku: board.sku, ...board.defaults, spares: 0, rider_kg: onScale(q.get("rider"), RIDER), gear: onScale(q.get("gear"), GEAR) };
  for (const slot of SLOT_KEYS) {
    const part = catalog.components.find((c) => c.sku === q.get(slot) && c.slot === slot && c.fits.includes(board.name));
    if (part) picks[slot] = part.sku;
  }
  const spares = q.get("spares");
  if (spares === "0" || spares === "1" || spares === "2") picks.spares = Number(spares);
  return picks;
}

function picksFromQuote(quote: Build): Picks {
  return {
    board_sku: quote.board_sku, wing: quote.slots.wing.sku, mast: quote.slots.mast.sku, propulsion: quote.slots.propulsion.sku,
    battery: quote.slots.battery.sku, controller: quote.slots.controller.sku, spares: quote.spares, rider_kg: quote.rider_kg, gear: quote.gear,
  };
}

interface Option {
  input: HTMLInputElement;
  meta: HTMLElement;
  reason: HTMLElement;
}

function radioGroup(label: string, name: string, items: { value: string; label: string; swatch?: string }[], onPick: (value: string) => void, onHover?: (value: string | null) => void): { el: HTMLElement; options: Map<string, Option>; error: HTMLElement } {
  const headingId = uid("group");
  const options = new Map<string, Option>();
  const error = h("p", { class: "field-error", hidden: true });
  const el = h("div", { class: "option-group" },
    h("h3", { id: headingId, class: "option-title" }, label),
    h("div", { role: "radiogroup", "aria-labelledby": headingId, class: "options" },
      items.map((item) => {
        const id = uid("opt");
        const reason = h("p", { class: "option-reason", id: `${id}-why`, hidden: true });
        const meta = h("span", { class: "option-meta" });
        const input = h("input", { type: "radio", class: "sr-radio", name, id, value: item.value });
        input.addEventListener("change", () => input.checked && onPick(item.value));
        const row = h("div", { class: "option" }, input,
          h("label", { for: id },
            item.swatch ? h("span", { class: "swatch", style: `--swatch:${item.swatch}`, "aria-hidden": "true" }) : null,
            h("span", { class: "option-name" }, item.label), meta,
            icon("tick", 18, "icon option-tick"), icon("notAllowed", 18, "icon option-blocked")),
          reason);
        if (onHover) {
          row.addEventListener("pointerenter", () => input.disabled && onHover(item.value));
          row.addEventListener("pointerleave", () => onHover(null));
        }
        options.set(item.value, { input, meta, reason });
        return row;
      })),
    error);
  return { el, options, error };
}

/** A slider with its value shown beside the thumb and as the value text; `onPick` runs for each value it settles on. */
function slider(label: string, scale: typeof RIDER, text: (n: number) => string, onPick: (n: number) => void): { el: HTMLElement; set(n: number): void; error: HTMLElement } {
  const headingId = uid("slider");
  const error = h("p", { class: "field-error", hidden: true });
  const input = h("input", { type: "range", class: "slider-input", min: scale.min, max: scale.max, step: scale.step, "aria-labelledby": headingId });
  const value = h("span", { class: "slider-value", "aria-hidden": "true" });
  const track = h("div", { class: "slider-track" }, value, input);
  let current = scale.standard;
  const show = (n: number) => {
    input.value = String(n);
    input.setAttribute("aria-valuetext", text(n));
    value.textContent = text(n);
    track.style.setProperty("--at", String((n - scale.min) / (scale.max - scale.min)));
  };
  input.addEventListener("input", () => {
    const n = Number(input.value);
    show(n);
    if (n === current) return;
    current = n;
    onPick(n);
  });
  return {
    el: h("div", { class: "option-group" }, h("h3", { id: headingId, class: "option-title" }, label), track, error),
    set(n) {
      current = n;
      show(n);
    },
    error,
  };
}

function setReason(option: Option, text: string | null, lozenge = false): void {
  option.reason.hidden = !text;
  option.reason.textContent = text ?? "";
  option.reason.classList.toggle("badge-lozenge", lozenge && text !== null);
  if (text) option.input.setAttribute("aria-describedby", option.reason.id);
  else option.input.removeAttribute("aria-describedby");
}

export async function build(ctx: PageContext): Promise<void> {
  document.title = "Build your board | Tern Foils";
  const { main } = ctx;
  const cat = await api<Catalog>("GET", "/api/catalog");
  if (!cat.ok) {
    main.append(h("div", { class: "wrap" }, h("p", { role: "alert" }, cat.error.message)));
    return;
  }
  const catalog = cat.data;
  let savedCode: string | null = ctx.params.code ?? null;
  let quote: Build;
  if (savedCode) {
    const saved = await api<Build>("GET", `/api/builds/${encodeURIComponent(savedCode)}`);
    if (!saved.ok) {
      main.append(pageHead("We could not find that build.", "The link may be mistyped, or the build was never saved."), h("div", { class: "wrap" }, h("a", { href: "/build", class: "pill" }, "Start a new build")));
      return;
    }
    quote = saved.data;
  } else {
    const first = await api<Build>("POST", "/api/builds/quote", picksFromQuery(ctx.query, catalog));
    if (!first.ok) {
      main.append(h("div", { class: "wrap" }, h("p", { role: "alert" }, first.error.message)));
      return;
    }
    quote = first.data;
  }
  let picks = picksFromQuote(quote);
  const boardOf = (sku: string) => catalog.boards.find((b) => b.sku === sku) as BoardPackage;
  const part = (sku: string) => catalog.components.find((c) => c.sku === sku) as Component;

  const region = h("section", { class: "viewer", "aria-label": "Board viewer", "aria-describedby": "viewer-help" });
  const help = h("p", { id: "viewer-help", class: "sr-only" }, "Drag or use the arrow keys to turn the board, plus and minus to zoom, Home to reset.");
  const viewer = new BoardViewer(region, parseView(ctx.query), () => writeAddress());
  const advisor = h("a", { class: "onward advisor-link" }, "Talk to an advisor about this build", icon("arrow", 18));

  function writeAddress(): void {
    const view = viewer.viewParam();
    const path = savedCode
      ? `/build/${savedCode}?${view}`
      : `/build?board=${picks.board_sku}&${SLOT_KEYS.map((s) => `${s}=${picks[s]}`).join("&")}&spares=${picks.spares}&rider=${picks.rider_kg}&gear=${picks.gear}&${view}`;
    if (location.pathname + location.search !== path) history.replaceState(history.state, "", path);
    advisor.hidden = !savedCode;
    advisor.setAttribute("href", `/callback?build=${savedCode ?? ""}&${view}`);
  }

  let sequence = 0;
  async function requote(next: Picks): Promise<void> {
    picks = next;
    savedCode = null;
    syncChecked();
    writeAddress();
    const mine = ++sequence;
    const r = await api<Build>("POST", "/api/builds/quote", next);
    if (mine !== sequence) return;
    for (const e of errors.values()) e.hidden = true;
    if (!r.ok) {
      const field = Object.keys(r.error.fields ?? {})[0];
      const error = field ? errors.get(field) : undefined;
      if (error) {
        error.hidden = false;
        error.textContent = r.error.fields?.[field!] ?? r.error.message;
      } else summaryAlert.textContent = r.error.message;
      return;
    }
    summaryAlert.textContent = "";
    quote = r.data;
    renderSummary();
    viewer.update(viewerBuild(quote, catalog));
    announce(`Build total ${price(quote.total_cents)}, up to ${quote.total_ride_min} min.`);
  }

  const boardGroup = radioGroup("Board", "board", catalog.boards.map((b) => ({ value: b.sku, label: `${b.name} ${b.size}`, swatch: hue(b.finish) })), (sku) => {
    const board = boardOf(sku);
    syncOptions(board);
    void requote({ board_sku: sku, ...board.defaults, spares: 0, rider_kg: picks.rider_kg, gear: picks.gear });
  });
  for (const b of catalog.boards) {
    const option = boardGroup.options.get(b.sku)!;
    option.meta.textContent = price(b.price_cents);
    option.input.disabled = !b.in_stock;
    setReason(option, b.in_stock ? null : "Out of Stock", true);
  }
  const groups = new Map<Slot, ReturnType<typeof radioGroup>>();
  for (const [slot, label] of SLOT_NAMES) {
    const items = catalog.components.filter((c) => c.slot === slot);
    groups.set(slot, radioGroup(label, slot, items.map((c) => ({ value: c.sku, label: c.name, swatch: hue(c.colour) })),
      (sku) => void requote({ ...picks, [slot]: sku }),
      (sku) => viewer.ghost(sku ? slot : null, sku ? part(sku) : null)));
  }
  const spareGroup = radioGroup("Spare batteries", "spares", ["0", "1", "2"].map((n) => ({ value: n, label: n })), (n) => void requote({ ...picks, spares: Number(n) }));
  const riderSlider = slider("Rider weight", RIDER, (kg) => `${kg} kg`, (kg) => void requote({ ...picks, rider_kg: kg }));
  const gearSlider = slider("Speed gear", GEAR, (n) => `Gear ${n}`, (n) => void requote({ ...picks, gear: n }));
  const errors = new Map<string, HTMLElement>([
    ["board_sku", boardGroup.error], ...[...groups].map(([slot, g]): [string, HTMLElement] => [slot, g.error]),
    ["spares", spareGroup.error], ["rider_kg", riderSlider.error], ["gear", gearSlider.error],
  ]);

  function syncOptions(board: BoardPackage): void {
    for (const [slot, group] of groups) {
      for (const [sku, option] of group.options) {
        const fits = part(sku).fits.includes(board.name);
        option.input.disabled = !fits;
        option.meta.textContent = sku === board.defaults[slot] ? "Included" : `+${price(boot.optionDeltas[board.sku]![sku]!)}`;
        setReason(option, fits ? null : `Not compatible with ${board.name}`);
      }
    }
  }

  function syncChecked(): void {
    boardGroup.options.get(picks.board_sku)!.input.checked = true;
    for (const [slot, group] of groups) group.options.get(picks[slot])!.input.checked = true;
    spareGroup.options.get(String(picks.spares))!.input.checked = true;
    riderSlider.set(picks.rider_kg);
    gearSlider.set(picks.gear);
  }

  const summaryAlert = h("div", { role: "alert", class: "form-alert" });
  const details = h("div", { class: "summary-details" });
  const rideText = h("span", { "data-ride-min": quote.total_ride_min }, `Up to ${quote.total_ride_min} min`);
  const gaugeBox = h("span", { class: "gauge-box" }, gauge(quote.battery_bars));
  const ride = h("div", { class: "summary-ride" }, gaugeBox, rideText);
  const total = h("div", { class: "summary-total" });
  const monthly = h("div", { class: "summary-financing" });
  const save = h("button", { type: "button", class: "pill pill-outline" }, "Save build");
  const add = h("button", { type: "button", class: "pill" }, "Add to cart");
  const copy = h("button", { type: "button", class: "pill pill-quiet" }, "Copy link");
  const summary = h("section", { class: "summary", "aria-label": "Build summary" },
    h("div", { class: "summary-main" }, h("h2", { class: "summary-title" }, "Your build"), details),
    h("div", { class: "summary-side" },
      h("div", { class: "summary-bar" }, ride, total, add),
      monthly,
      h("div", { class: "summary-actions" }, save, copy), advisor, summaryAlert));

  // "Up to N min" counts from the shown value to the settled one; the gauge and the viewer's charge follow at the end.
  let shownMin = quote.total_ride_min;
  let stopCount: (() => void) | null = null;
  function countRide(to: number, bars: number): void {
    rideText.setAttribute("data-ride-min", String(to));
    stopCount?.();
    const from = shownMin;
    const show = (n: number) => {
      shownMin = n;
      rideText.textContent = `Up to ${n} min`;
    };
    const settle = () => {
      stopCount = null;
      show(to);
      replace(gaugeBox, gauge(bars));
      viewer.setFill(bars);
    };
    if (reducedMotion() || from === to) {
      settle();
      return;
    }
    stopCount = tween(RIDE_COUNT_MS, CURVES.decelerate, (p, done) => (done ? settle() : show(Math.round(from + (to - from) * p))));
  }

  function renderSummary(): void {
    const board = boardOf(quote.board_sku);
    replace(details,
      h("p", { class: "summary-board" }, `${quote.board_name} ${board.size}`, h("span", { class: "caption" }, ` · ${board.finish}`)),
      h("dl", { class: "summary-lines" },
        SLOT_NAMES.map(([slot, label]) => h("div", null, h("dt", null, label), h("dd", null, quote.slots[slot].name))),
        h("div", null, h("dt", null, "Rider weight"), h("dd", null, `${quote.rider_kg} kg`)),
        h("div", null, h("dt", null, "Speed gear"), h("dd", null, `Gear ${quote.gear}`))),
      h("p", { class: "summary-spares" }, `Spares: ${quote.spares}`));
    replace(total, h("span", { class: "summary-total-label" }, "Build total"), h("span", { class: "summary-total-value" }, price(quote.total_cents)));
    replace(monthly, financingLine(lowestMonthly(quote.financing)));
    countRide(quote.total_ride_min, quote.battery_bars);
  }

  save.addEventListener("click", async () => {
    summaryAlert.textContent = "";
    const r = await busy(save, "Saving...", () => api<Build>("POST", "/api/builds", picks));
    if (!r.ok) {
      summaryAlert.textContent = r.error.message;
      return;
    }
    savedCode = r.data.code;
    history.pushState(null, "", `/build/${savedCode}?${viewer.viewParam()}`);
    writeAddress();
    announce("Build saved.");
  });
  add.addEventListener("click", async () => {
    summaryAlert.textContent = "";
    const result = await busy(add, "Adding...", async () => {
      const saved = await api<Build>("POST", "/api/builds", picks);
      if (!saved.ok) return saved;
      return api<Cart>("POST", "/api/cart/lines", { type: "build", code: saved.data.code, quantity: 1 });
    });
    if (!result.ok) {
      summaryAlert.textContent = result.error.message;
      return;
    }
    const cart = result.data as Cart;
    const line = cart.lines.find((l) => l.code === quote.code);
    openCartDrawer(add, line?.name ?? "", cart);
    announce(`Added ${line?.name ?? ""}. Cart has ${cart.item_count} items.`);
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      announce("Link copied.");
    } catch {
      announce("Copy the address from your browser's address bar.");
    }
  });

  syncOptions(boardOf(picks.board_sku));
  syncChecked();
  renderSummary();
  main.append(h("div", { class: "wrap build-page" },
    h("div", { class: "build-head" }, h("h1", { tabindex: "-1" }, "Build your board"), onward("/match", "Not sure? Take the quiz")),
    h("div", { class: "build-grid" },
      h("div", { class: "build-options" }, boardGroup.el, [...groups.values()].map((g) => g.el), spareGroup.el, riderSlider.el, gearSlider.el),
      h("div", { class: "build-stage" }, region, help, summary))));
  writeAddress();
  await viewer.start(viewerBuild(quote, catalog), quote.battery_bars);
}
