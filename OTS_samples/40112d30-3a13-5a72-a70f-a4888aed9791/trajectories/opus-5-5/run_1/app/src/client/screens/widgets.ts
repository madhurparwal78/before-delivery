import { formatLongDate, LONG_MONTHS } from "../../shared/formats.js";
import { M } from "../../shared/messages.js";
import type { Option } from "../../shared/types.js";
import { announce, h, openDialog } from "../dom.js";

/* ---------- Grid (wide) ---------- */

export interface GridWidget {
  el: HTMLElement;
  cards: HTMLElement;
  set(value: Record<string, string>): void;
  focusTarget(): HTMLElement | null;
  invalidTargets(): HTMLElement[];
}

/** A grid question: one tab stop on wide screens, radio cards on phones. */
export function gridWidget(
  key: string,
  labelId: string,
  rows: Option[],
  columns: Option[],
  initial: Record<string, string>,
  onChange: (value: Record<string, string>) => void,
): GridWidget {
  let value = { ...initial };
  let active: HTMLElement | null = null;
  const cells: HTMLElement[][] = [];
  const grid = h(
    "div",
    { role: "grid", "aria-labelledby": labelId, class: "grid-wide" },
    h(
      "div",
      { role: "row", class: "grid-row grid-head" },
      h("span", { role: "columnheader", class: "grid-corner" }),
      columns.map((c) => h("span", { role: "columnheader" }, c.label)),
    ),
  );
  const radios = new Map<string, HTMLInputElement>();
  const cards = h("div", { class: "grid-cards" });
  rows.forEach((row, r) => {
    const rowCells = columns.map((column, c) => {
      const cell = h("div", {
        role: "gridcell",
        tabindex: "-1",
        "aria-label": `${row.label}: ${column.label}`,
        "aria-selected": "false",
        class: "grid-cell",
        "data-row": row.value,
        "data-column": column.value,
      });
      cell.addEventListener("click", () => {
        move(r, c);
        choose(r, c);
      });
      return cell;
    });
    cells.push(rowCells);
    grid.append(h("div", { role: "row", class: "grid-row" }, h("span", { role: "rowheader" }, row.label), rowCells));
    const group = h(
      "div",
      { role: "radiogroup", "aria-label": row.label, class: "grid-card" },
      h("p", { class: "grid-card-title", "aria-hidden": "true" }, row.label),
      columns.map((column) => {
        const radio = h("input", { type: "radio", name: `${key}__${row.value}`, value: column.value, id: `${key}__${row.value}__${column.value}` });
        radio.addEventListener("change", () => {
          value = { ...value, [row.value]: column.value };
          sync();
          onChange(value);
        });
        radios.set(`${row.value}\u0000${column.value}`, radio);
        return h("div", { class: "choice-option" }, radio, h("label", { for: radio.id }, column.label));
      }),
    );
    cards.append(group);
  });
  const sync = (): void => {
    rows.forEach((row, r) =>
      columns.forEach((column, c) => {
        const selected = value[row.value] === column.value;
        cells[r][c].setAttribute("aria-selected", String(selected));
        (radios.get(`${row.value}\u0000${column.value}`) as HTMLInputElement).checked = selected;
      }),
    );
  };
  const move = (r: number, c: number): void => {
    const cell = cells[r]?.[c];
    if (!cell) return;
    if (active) active.tabIndex = -1;
    active = cell;
    cell.tabIndex = 0;
    cell.focus();
  };
  const choose = (r: number, c: number): void => {
    value = { ...value, [rows[r].value]: columns[c].value };
    sync();
    onChange(value);
  };
  grid.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    let r = -1;
    let c = -1;
    cells.forEach((rowCells, ri) => {
      const ci = rowCells.indexOf(target);
      if (ci >= 0) [r, c] = [ri, ci];
    });
    if (r < 0) return;
    const lastRow = cells.length - 1;
    const lastCol = columns.length - 1;
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(r, Math.min(lastCol, c + 1)),
      ArrowLeft: () => move(r, Math.max(0, c - 1)),
      ArrowDown: () => move(Math.min(lastRow, r + 1), c),
      ArrowUp: () => move(Math.max(0, r - 1), c),
      Home: () => (event.ctrlKey ? move(0, 0) : move(r, 0)),
      End: () => (event.ctrlKey ? move(lastRow, lastCol) : move(r, lastCol)),
      " ": () => choose(r, c),
      Enter: () => choose(r, c),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  });
  if (cells[0]?.[0]) {
    active = cells[0][0];
    active.tabIndex = 0;
  }
  sync();
  const phone = (): boolean => window.matchMedia("(max-width: 767px)").matches;
  return {
    el: grid,
    cards,
    set(next) {
      value = { ...next };
      sync();
    },
    focusTarget() {
      const r = Math.max(0, rows.findIndex((row) => !value[row.value]));
      if (phone()) return cards.querySelectorAll<HTMLElement>(".grid-card")[r]?.querySelector("input") ?? null;
      if (!cells[r]?.[0]) return null;
      move(r, 0);
      return cells[r][0];
    },
    invalidTargets() {
      return [grid, ...cards.querySelectorAll<HTMLElement>(".grid-card")];
    },
  };
}

/* ---------- Ranking ---------- */

export interface RankingWidget {
  el: HTMLElement;
  first(): HTMLElement | null;
}

export function rankingWidget(labelId: string, options: Option[], initial: string[] | null, onCommit: (order: string[]) => void): RankingWidget {
  let order = initial && initial.length === options.length ? [...initial] : options.map((o) => o.value);
  const list = h("ul", { role: "list", "aria-labelledby": labelId, class: "ranking" });
  let grabbed: { value: string; from: number } | null = null;
  const items = new Map<string, HTMLElement>();
  const buttons = new Map<string, { up: HTMLButtonElement; down: HTMLButtonElement }>();
  const position = (value: string): number => order.indexOf(value) + 1;
  const render = (): void => {
    for (const value of order) list.append(items.get(value) as HTMLElement);
    order.forEach((value, index) => {
      const item = items.get(value) as HTMLElement;
      item.setAttribute("aria-posinset", String(index + 1));
      item.setAttribute("aria-setsize", String(order.length));
      const pair = buttons.get(value) as { up: HTMLButtonElement; down: HTMLButtonElement };
      pair.up.setAttribute("aria-disabled", String(index === 0));
      pair.down.setAttribute("aria-disabled", String(index === order.length - 1));
    });
  };
  const shift = (value: string, delta: number): boolean => {
    const from = order.indexOf(value);
    const to = from + delta;
    if (to < 0 || to >= order.length) return false;
    order.splice(from, 1);
    order.splice(to, 0, value);
    render();
    return true;
  };
  for (const option of options) {
    const up = h("button", { type: "button", class: "rank-move", "aria-label": `Move ${option.label} up` }, "↑");
    const down = h("button", { type: "button", class: "rank-move", "aria-label": `Move ${option.label} down` }, "↓");
    const item = h(
      "li",
      { role: "listitem", tabindex: "0", class: "rank-item", "data-value": option.value, "data-grabbed": "false" },
      h("span", { class: "rank-label" }, option.label),
      h("span", { class: "rank-buttons" }, up, down),
    );
    for (const [button, delta] of [
      [up, -1],
      [down, 1],
    ] as const)
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (button.getAttribute("aria-disabled") === "true") return;
        if (shift(option.value, delta)) {
          button.focus();
          announce(M.moved(option.label, position(option.value), order.length));
          onCommit([...order]);
        }
      });
    item.addEventListener("keydown", (event) => {
      if (event.target !== item) return;
      if (event.key === " ") {
        event.preventDefault();
        if (grabbed?.value === option.value) {
          grabbed = null;
          item.dataset.grabbed = "false";
          announce(M.dropped(option.label, position(option.value), order.length));
          onCommit([...order]);
        } else {
          if (grabbed) (items.get(grabbed.value) as HTMLElement).dataset.grabbed = "false";
          grabbed = { value: option.value, from: order.indexOf(option.value) };
          item.dataset.grabbed = "true";
          announce(M.pickedUp(option.label, position(option.value), order.length));
        }
      } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && grabbed?.value === option.value) {
        event.preventDefault();
        if (shift(option.value, event.key === "ArrowUp" ? -1 : 1)) {
          item.focus();
          announce(M.moved(option.label, position(option.value), order.length));
        }
      } else if (event.key === "Escape" && grabbed?.value === option.value) {
        event.preventDefault();
        event.stopPropagation();
        order.splice(order.indexOf(option.value), 1);
        order.splice(grabbed.from, 0, option.value);
        grabbed = null;
        item.dataset.grabbed = "false";
        render();
        item.focus();
        announce(M.moveCancelled(option.label, position(option.value), order.length));
      }
    });
    addDrag(item, list, (target) => {
      const from = order.indexOf(option.value);
      if (target === from) return;
      order.splice(from, 1);
      order.splice(target, 0, option.value);
      render();
      announce(M.moved(option.label, target + 1, order.length));
      onCommit([...order]);
    });
    items.set(option.value, item);
    buttons.set(option.value, { up, down });
  }
  render();
  return { el: list, first: () => list.querySelector<HTMLElement>(".rank-item") };
}

/** Dragging an item by mouse or finger moves it on release. */
function addDrag(item: HTMLElement, list: HTMLElement, drop: (index: number) => void): void {
  item.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button") || event.button !== 0) return;
    const startY = event.clientY;
    let moved = false;
    item.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent): void => {
      if (Math.abs(e.clientY - startY) > 6) moved = true;
      if (moved) item.style.transform = `translateY(${e.clientY - startY}px)`;
    };
    const onUp = (e: PointerEvent): void => {
      item.removeEventListener("pointermove", onMove);
      item.removeEventListener("pointerup", onUp);
      item.removeEventListener("pointercancel", onUp);
      item.style.transform = "";
      if (!moved) return;
      const siblings = [...list.querySelectorAll<HTMLElement>(".rank-item")].filter((x) => x !== item);
      let index = siblings.findIndex((x) => {
        const box = x.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });
      if (index < 0) index = siblings.length;
      drop(index);
    };
    item.addEventListener("pointermove", onMove);
    item.addEventListener("pointerup", onUp);
    item.addEventListener("pointercancel", onUp);
  });
}

/* ---------- Scale ---------- */

export interface ScaleWidget {
  el: HTMLElement;
  focusTarget(): HTMLElement | null;
}

export function scaleWidget(
  labelId: string,
  min: number,
  max: number,
  minLabel: string | null,
  maxLabel: string | null,
  initial: string | null,
  onChange: (value: string) => void,
): ScaleWidget {
  const describedBy: string[] = [];
  const ends = h("div", { class: "scale-ends muted" });
  if (minLabel) {
    const id = `${labelId}-min`;
    describedBy.push(id);
    ends.append(h("span", { id }, minLabel));
  }
  if (maxLabel) {
    const id = `${labelId}-max`;
    describedBy.push(id);
    ends.append(h("span", { id }, maxLabel));
  }
  const group = h("div", {
    role: "radiogroup",
    "aria-labelledby": labelId,
    "aria-describedby": describedBy.length ? describedBy.join(" ") : null,
    class: "scale",
  });
  const radios: HTMLElement[] = [];
  let current = initial === null ? null : Number(initial);
  const select = (n: number, commit: boolean): void => {
    current = n;
    radios.forEach((radio, i) => {
      const checked = min + i === n;
      radio.setAttribute("aria-checked", String(checked));
      radio.tabIndex = checked ? 0 : -1;
    });
    radios[n - min].focus();
    if (commit) onChange(String(n));
  };
  for (let n = min; n <= max; n++) {
    const radio = h("div", { role: "radio", "aria-checked": String(current === n), tabindex: "-1", class: "scale-option" }, String(n));
    radio.addEventListener("click", () => select(n, true));
    radios.push(radio);
    group.append(radio);
  }
  (radios[current === null ? 0 : current - min] ?? radios[0]).tabIndex = 0;
  group.addEventListener("keydown", (event) => {
    const at = current ?? min - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(max, current === null ? min : at + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(min, current === null ? min : at - 1);
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else if (event.key === " " || event.key === "Enter") next = current ?? min;
    else if (/^\d$/.test(event.key) && Number(event.key) >= min && Number(event.key) <= max) next = Number(event.key);
    if (next === null) return;
    event.preventDefault();
    if (next === current) {
      radios[next - min].focus();
      return;
    }
    select(next, true);
  });
  return {
    el: h("div", { class: "scale-wrap" }, group, ends),
    focusTarget: () => radios.find((r) => r.getAttribute("aria-checked") === "true") ?? radios[0] ?? null,
  };
}

/* ---------- Date picker ---------- */

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), last)));
}

export interface DateLimits {
  min: string | null;
  max: string | null;
  today: string;
}

/** The Choose a date dialog; it opens on the selected day, else today, else the nearest allowed day. */
export function openDatePicker(opener: HTMLElement, selected: string | null, limits: DateLimits, pick: (value: string) => void): void {
  const allowed = (day: string): boolean => (!limits.min || day >= limits.min) && (!limits.max || day <= limits.max);
  let start = selected ?? limits.today;
  if (!selected) {
    if (limits.min && start < limits.min) start = limits.min;
    if (limits.max && start > limits.max) start = limits.max;
  }
  let focused = parse(start);
  const previous = h("button", { type: "button" }, "Previous month");
  const next = h("button", { type: "button" }, "Next month");
  const heading = h("p", { class: "calendar-month", "aria-hidden": "true" });
  const gridHolder = h("div", { class: "calendar-holder" });
  const close = h("button", { type: "button" }, "Close");
  let activeCell: HTMLElement | null = null;
  let done = false;
  const choose = (day: string): void => {
    if (!allowed(day) || done) return;
    done = true;
    dialog.close();
    pick(day);
  };
  const render = (focus: boolean): void => {
    const year = focused.getUTCFullYear();
    const month = focused.getUTCMonth();
    const name = `${LONG_MONTHS[month]} ${year}`;
    heading.textContent = name;
    const first = new Date(Date.UTC(year, month, 1));
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;
    const grid = h(
      "div",
      { role: "grid", "aria-label": name, class: "calendar" },
      h("div", { role: "row", class: "calendar-row" }, ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => h("span", { role: "columnheader" }, d))),
    );
    let row = h("div", { role: "row", class: "calendar-row" });
    for (let i = 0; i < lead; i++) row.append(h("span", { role: "gridcell", class: "calendar-pad" }));
    for (let d = 1; d <= days; d++) {
      const day = iso(new Date(Date.UTC(year, month, d)));
      const isFocused = day === iso(focused);
      const cell = h(
        "div",
        {
          role: "gridcell",
          tabindex: isFocused ? "0" : "-1",
          "aria-label": formatLongDate(day),
          "aria-selected": String(day === selected),
          "aria-disabled": allowed(day) ? null : "true",
          "aria-current": day === limits.today ? "date" : null,
          class: "calendar-day",
          "data-date": day,
        },
        String(d),
      );
      cell.addEventListener("click", () => choose(day));
      if (isFocused) activeCell = cell;
      row.append(cell);
      if ((lead + d) % 7 === 0) {
        grid.append(row);
        row = h("div", { role: "row", class: "calendar-row" });
      }
    }
    if (row.children.length) grid.append(row);
    gridHolder.replaceChildren(grid);
    grid.addEventListener("keydown", onKey);
    if (focus) activeCell?.focus();
  };
  const moveTo = (date: Date): void => {
    focused = date;
    render(true);
  };
  const onKey = (event: KeyboardEvent): void => {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -((focused.getUTCDay() + 6) % 7)),
      End: () => addDays(focused, 6 - ((focused.getUTCDay() + 6) % 7)),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
    };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(iso(focused));
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveTo(move());
  };
  previous.addEventListener("click", () => {
    focused = addMonths(focused, -1);
    render(false);
  });
  next.addEventListener("click", () => {
    focused = addMonths(focused, 1);
    render(false);
  });
  close.addEventListener("click", () => dialog.close());
  const dialog = openDialog(
    { title: "Choose a date", opener, className: "date-dialog", tabStops: () => [previous, next, activeCell, close].filter((x): x is HTMLElement => x !== null) },
    h("div", { class: "calendar-head" }, previous, heading, next),
    gridHolder,
    close,
  );
  render(true);
}
