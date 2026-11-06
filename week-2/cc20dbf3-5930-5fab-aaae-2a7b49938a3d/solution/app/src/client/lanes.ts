// Unit lanes: one 28-day strip per unit, closed days narrow and grey, busy spans filled with their status
// pattern, and a summary line per span so narrow spans stay readable.

import type { Lanes, Span } from "../shared/api.js";
import { addDays, daysBetween, formatDay, isOpenDay } from "../shared/calendar.js";
import { h } from "./dom.js";
import { calendar } from "./session.js";
import { freeChip, spanChip } from "./status.js";

export interface LaneState {
  lanes: Lanes;
  range: { start: string; end: string } | null;
  claimedUnitId: string | null;
}

interface Column {
  day: string;
  open: boolean;
  weight: number;
}

function columns(from: string, count: number): Column[] {
  return Array.from({ length: count }, (_, i) => {
    const day = addDays(from, i);
    const open = isOpenDay(calendar(), day);
    return { day, open, weight: open ? 2 : 1 };
  });
}

/** Where a date range sits along the strip, as fractions of its width. */
export function rangeFraction(lanes: Lanes, range: { start: string; end: string }): { left: number; width: number } {
  const cols = columns(lanes.from, daysBetween(lanes.from, lanes.to) + 1);
  const total = cols.reduce((sum, c) => sum + c.weight, 0);
  let left = 0;
  let width = 0;
  for (const col of cols) {
    if (col.day < range.start) left += col.weight;
    else if (col.day <= range.end) width += col.weight;
  }
  return { left: left / total, width: Math.max(width, 1) / total };
}

function spanLine(span: Span): HTMLLIElement {
  const tail: string[] = [];
  if (span.borrower) tail.push(span.borrower.name);
  else if (span.mine) tail.push("yours");
  return h(
    "li",
    { class: "lane__span" },
    spanChip(span.status),
    ` ${formatDay(span.start_date)}–${formatDay(span.end_date)} · back ${span.back_on ? formatDay(span.back_on) : "once returned"}`,
    tail.length ? ` · ${tail.join(" · ")}` : "",
  );
}

export function claimBar(): HTMLDivElement {
  return h("div", { role: "img", "aria-label": "Claim bar", class: "claim-bar" });
}

function axis(cols: Column[], template: string): HTMLDivElement {
  const row = h("div", { class: "lanes__axis", "aria-hidden": "true" });
  row.style.gridTemplateColumns = template;
  cols.forEach((col, i) => row.append(h("span", { class: "lanes__tick" }, i % 7 === 0 ? formatDay(col.day).slice(4) : "")));
  return row;
}

/** Rebuilds the lane groups inside `stack`. */
export function renderLanes(stack: HTMLElement, state: LaneState): void {
  const { lanes, range, claimedUnitId } = state;
  const cols = columns(lanes.from, daysBetween(lanes.from, lanes.to) + 1);
  const template = cols.map((c) => `${c.weight}fr`).join(" ");
  const groups = lanes.lanes.map((lane) => {
    const strip = h("div", { class: "lane__strip" });
    strip.style.gridTemplateColumns = template;
    const freeForRange = range !== null && lane.busy_for_range === false;
    cols.forEach((col, i) => {
      const span = lane.spans.find((s) => s.start_date <= col.day && col.day <= s.end_date);
      const inRange = range !== null && range.start <= col.day && col.day <= range.end;
      const classes = ["cell"];
      if (i % 7 === 0) classes.push("cell--marker");
      if (!col.open) classes.push("cell--closed");
      else if (span) classes.push(`cell--${span.status}`);
      else if (inRange) classes.push(freeForRange ? "cell--free" : "cell--range");
      strip.append(
        col.open
          ? h("span", { class: classes.join(" "), "aria-hidden": "true" })
          : h("span", { class: classes.join(" ") }, h("span", { class: "sr-only" }, "closed")),
      );
    });
    if (claimedUnitId === lane.unit_id && range) {
      const bar = claimBar();
      bar.classList.add("claim-bar--settled");
      const { left, width } = rangeFraction(lanes, range);
      bar.style.left = `${left * 100}%`;
      bar.style.width = `${width * 100}%`;
      strip.append(bar);
    }
    const summary = h("ul", { class: "lane__summary" });
    if (lane.spans.length) lane.spans.forEach((span) => summary.append(spanLine(span)));
    else summary.append(h("li", { class: "lane__span" }, freeChip(), " all 28 days"));
    return h(
      "div",
      { role: "group", "aria-label": `Unit ${lane.label}`, class: `lane${lane.busy_for_range ? " lane--busy" : ""}`, "data-unit": lane.unit_id },
      h("p", { class: "lane__label label" }, `Unit ${lane.label}`),
      strip,
      summary,
    );
  });
  stack.replaceChildren(axis(cols, template), h("div", { class: "lanes__groups" }, groups));
}
