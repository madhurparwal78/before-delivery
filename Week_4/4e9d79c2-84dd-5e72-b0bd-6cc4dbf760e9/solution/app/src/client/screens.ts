// The working screens' own behaviour: filters, state bar, trip, diary, ribbon, seats, quote, payments, changes, documents.
import { $, $$, announce, call, clearBusy, EASE, reducedMotion, safely, setBusy, type ReplyBody } from "./core.js";
import { closeDialog } from "./dialogs.js";
import { clearProblems, collect, refusal, registerFlow, showProblems, succeeded } from "./forms.js";
import { softNavigate } from "./nav.js";
import { afterRefresh, holdRefresh, refreshNow, releaseRefresh } from "./refresh.js";
import { printedMoney as moneyOf } from "../shared/rules.js";
import { addDays, isoWeekOf, longDate, mondayOfIsoWeek } from "../shared/time.js";


// ---- Filters in the address.
const SEARCH_PAUSE_MS = 300;
const filterUrl = (form: HTMLFormElement): string => {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form).entries()) if (value) params.set(key, String(value));
  const text = params.toString();
  return location.pathname + (text ? `?${text}` : "");
};
const initFilters = (): void => {
  let timer = 0;
  document.addEventListener("change", (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-filters]");
    if (!form || (event.target as HTMLInputElement).type === "search") return;
    void softNavigate(filterUrl(form));
  });
  document.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    const form = input.closest<HTMLFormElement>("[data-filters]");
    if (!form || input.type !== "search") return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void softNavigate(filterUrl(form), "replace"), SEARCH_PAUSE_MS);
  });
  document.addEventListener("submit", (event) => {
    if ((event.target as HTMLElement).matches("[data-filters]")) event.preventDefault();
  });
};

// ---- The State bar.
const initStateBar = (): void => {
  document.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    const bar = input.closest<HTMLElement>("[data-state-bar]");
    if (!bar) return;
    const previous = $$<HTMLInputElement>("input", bar).find((r) => r.defaultChecked);
    const saving = $("[data-saving]");
    const [method, path] = (bar.dataset.api as string).split(" ");
    bar.dataset.pending = "1";
    if (saving) saving.hidden = false;
    void safely(() => call(method, path, { state: input.value })).then((reply) => {
      delete bar.dataset.pending;
      if (saving) saving.hidden = true;
      if (reply.ok) {
        for (const radio of $$<HTMLInputElement>("input", bar)) radio.defaultChecked = radio === input;
        announce("State saved.");
      } else {
        if (previous) previous.checked = true;
        (previous ?? input).focus();
        announce("That did not save. Try again.");
      }
      void refreshNow();
    });
  });
};

// ---- Trip plan: stops by drag, touch and buttons.
const flipRows = (rows: HTMLElement[], before: Map<HTMLElement, DOMRect>): void => {
  if (reducedMotion()) return;
  for (const row of rows) {
    const old = before.get(row);
    if (!old) continue;
    const y = old.top - row.getBoundingClientRect().top;
    if (Math.abs(y) > 1) row.animate([{ transform: `translateY(${y}px)` }, { transform: "none" }], { duration: 160, easing: EASE });
  }
};
const drawMoveButtons = (list: HTMLElement): void => {
  const rows = $$(".stop-row", list);
  rows.forEach((row, i) => {
    $(`[data-stop-move="-1"]`, row)?.setAttribute("aria-disabled", String(i === 0));
    $(`[data-stop-move="1"]`, row)?.setAttribute("aria-disabled", String(i === rows.length - 1));
  });
};
const placeStop = (list: HTMLElement, row: HTMLElement, index: number): void => {
  const focused = document.activeElement as HTMLElement | null;
  const rows = $$(".stop-row", list);
  const before = new Map(rows.map((r) => [r, r.getBoundingClientRect()]));
  const others = rows.filter((r) => r !== row);
  list.insertBefore(row, others[index] ?? null);
  flipRows(rows, before);
  drawMoveButtons(list);
  if (focused && focused !== document.activeElement) focused.focus({ preventScroll: true });
  const position = $$(".stop-row", list).indexOf(row) + 1;
  announce(`Stop ${position} of ${rows.length}: ${row.dataset.text}`, false);
  list.dataset.pending = "1";
  const order = $$(".stop-row", list).map((r) => r.dataset.stopId);
  void safely(() => call("PUT", `/api/enquiries/${list.dataset.hire}/trip/stops`, { order })).then((reply) => {
    delete list.dataset.pending;
    announce(reply.ok ? "Route updated." : "Route not updated. Showing the last good route.");
    void refreshNow();
  });
};
const initTrip = (): void => {
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-stop-move]");
    if (!button || button.getAttribute("aria-disabled") === "true") return;
    const row = button.closest<HTMLElement>(".stop-row") as HTMLElement;
    const list = row.closest<HTMLElement>("[data-trip]") as HTMLElement;
    placeStop(list, row, $$(".stop-row", list).indexOf(row) + Number(button.dataset.stopMove));
  });
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>(".stop-row");
    if (!row || target.closest("button")) return;
    const list = row.closest<HTMLElement>("[data-trip]") as HTMLElement;
    const startY = event.clientY;
    row.setPointerCapture(event.pointerId);
    row.classList.add("is-dragging");
    holdRefresh();
    let lastY = startY;
    const move = (e: PointerEvent): void => {
      lastY = e.clientY;
      row.style.transform = `translateY(${lastY - startY}px)`;
    };
    const end = (e: Event): void => {
      row.removeEventListener("pointermove", move);
      row.removeEventListener("pointerup", end);
      row.removeEventListener("pointercancel", end);
      row.classList.remove("is-dragging");
      row.style.transform = "";
      releaseRefresh();
      if (e.type === "pointercancel") return;
      const others = $$(".stop-row", list).filter((r) => r !== row);
      const index = others.filter((r) => { const box = r.getBoundingClientRect(); return box.top + box.height / 2 < lastY; }).length;
      if (index !== $$(".stop-row", list).indexOf(row)) placeStop(list, row, index);
    };
    row.addEventListener("pointermove", move);
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);
  });
};

// ---- Diary.
const rove = (grid: HTMLElement, target: HTMLElement): void => {
  for (const stop of $$<HTMLElement>("[tabindex]", grid)) stop.tabIndex = -1;
  target.tabIndex = 0;
};
const ensureRove = (grid: HTMLElement): void => {
  const stops = $$<HTMLElement>('[tabindex="0"]', grid);
  const keep = grid.contains(document.activeElement) && (document.activeElement as HTMLElement).hasAttribute("tabindex") ? document.activeElement as HTMLElement : stops[0];
  rove(grid, keep ?? $<HTMLElement>(".diary-card", grid) ?? ($(".week-cell", grid) as HTMLElement));
};
const moveRun = async (card: HTMLElement, date: string, time: string): Promise<boolean> => {
  const reply = await safely(() => call("PUT", `/api/runs/${card.dataset.run}/departure`, { departAt: { date, time } }));
  if (reply.ok) {
    announce(`Run ${card.dataset.number} moved to ${longDate(date)}.`);
    await refreshNow();
    return true;
  }
  announce(reply.json?.error?.message ?? "That did not save. Try again.");
  return false;
};
const cardBack = (card: HTMLElement, x: number): void => {
  card.style.transform = "";
  if (!reducedMotion() && x) card.animate([{ transform: `translateX(${x}px)` }, { transform: "none" }], { duration: 160, easing: EASE });
};
const initDiary = (): void => {
  document.addEventListener("keydown", (event) => {
    const here = (event.target as HTMLElement).closest<HTMLElement>("[data-week] [tabindex]");
    if (!here) return;
    const grid = here.closest<HTMLElement>("[data-week]") as HTMLElement;
    const card = here.classList.contains("diary-card") ? here : $<HTMLElement>(".diary-card", here);
    const cell = here.closest<HTMLElement>(".week-cell") as HTMLElement;
    const cells = $$(".week-cell", grid);
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      if (!card) return;
      void moveRun(card, addDays(cell.dataset.date as string, event.key === "ArrowLeft" ? -1 : 1), card.dataset.time as string).then((moved) => {
        const again = document.querySelector<HTMLElement>(`[data-key="card-${card.dataset.run}"]`);
        if (again && moved) { rove(grid, again); again.focus({ preventScroll: true }); }
      });
      return;
    }
    const at = cells.indexOf(cell);
    const targets: Record<string, number> = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: cells.length - 1 };
    const inCell = $$<HTMLElement>(".diary-card", cell);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = inCell[inCell.indexOf(here) + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) { rove(grid, next); next.focus(); }
      return;
    }
    if (event.key in targets && cells[targets[event.key]]) {
      event.preventDefault();
      const nextCell = cells[targets[event.key]];
      const next = $<HTMLElement>(".diary-card", nextCell) ?? nextCell;
      rove(grid, next);
      next.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>(".diary-card");
    if (!card || (event.target as HTMLElement).closest("button")) return;
    const grid = card.closest<HTMLElement>("[data-week]") as HTMLElement;
    const width = ($(".week-cell", grid) as HTMLElement).getBoundingClientRect().width;
    const startX = event.clientX;
    let dx = 0;
    let cancelled = false;
    card.setPointerCapture(event.pointerId);
    holdRefresh();
    const move = (e: PointerEvent): void => {
      if (cancelled) return;
      dx = e.clientX - startX;
      card.style.transform = `translateX(${dx}px)`;
    };
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      cancelled = true;
      cardBack(card, dx);
    };
    const end = (): void => {
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", end);
      card.removeEventListener("pointercancel", end);
      document.removeEventListener("keydown", escape, true);
      releaseRefresh();
      if (cancelled) return;
      const days = Math.round(dx / width);
      if (!days) return cardBack(card, dx);
      const date = addDays((card.closest(".week-cell") as HTMLElement).dataset.date as string, days);
      const at = dx;
      void moveRun(card, date, card.dataset.time as string).then((moved) => { if (!moved && card.isConnected) cardBack(card, at); });
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
    document.addEventListener("keydown", escape, true);
  });
  document.addEventListener("click", (event) => {
    const step = (event.target as HTMLElement).closest<HTMLElement>("[data-week-step]");
    if (!step) return;
    const grid = $<HTMLElement>("[data-week]") as HTMLElement;
    const monday = mondayOfIsoWeek(grid.dataset.weekValue as string) as string;
    void softNavigate(`/diary?week=${isoWeekOf(addDays(monday, Number(step.dataset.weekStep) * 7))}`);
  });
};

// ---- Duty ribbon.
interface RibbonBlock { kind: string; minutes: number }
const blocksOf = (ribbon: HTMLElement): RibbonBlock[] => JSON.parse(ribbon.dataset.blocks as string);
const drawBlocks = (ribbon: HTMLElement, blocks: RibbonBlock[]): void => {
  let at = 0;
  $$("[data-part='block']", ribbon).forEach((element, i) => {
    element.style.left = `${at}px`;
    element.style.width = `${blocks[i].minutes}px`;
    if (element.getAttribute("role") === "slider") element.setAttribute("aria-valuenow", String(at));
    at += blocks[i].minutes;
  });
  ribbon.dataset.blocks = JSON.stringify(blocks);
};
const shifted = (blocks: RibbonBlock[], index: number, minutes: number): RibbonBlock[] => {
  const before = blocks[index - 1];
  const after = blocks[index + 1];
  const next = blocks.map((b) => ({ ...b }));
  const room = minutes > 0 ? (after?.kind === "drive" ? after.minutes - 1 : 0) : before?.kind === "drive" ? before.minutes - 1 : 0;
  const by = Math.sign(minutes) * Math.min(Math.abs(minutes), Math.max(room, 0));
  if (next[index - 1]) next[index - 1].minutes += by;
  if (next[index + 1]) next[index + 1].minutes -= by;
  return next;
};
let ribbonSending = false;
let ribbonAgain = false;
const saveRibbon = async (ribbon: HTMLElement): Promise<void> => {
  if (ribbonSending) { ribbonAgain = true; return; }
  ribbonSending = true;
  ribbon.dataset.pending = "1";
  do {
    ribbonAgain = false;
    const reply = await safely(() => call("PUT", `/api/runs/${ribbon.dataset.run}/blocks`, { startAt: { date: ribbon.dataset.startDate, time: ribbon.dataset.startTime }, blocks: blocksOf(ribbon) }));
    announce(reply.ok ? "Break moved." : reply.json?.error?.message ?? "That did not save. Try again.");
  } while (ribbonAgain);
  ribbonSending = false;
  delete ribbon.dataset.pending;
  await refreshNow();
};
const moveBreak = (slider: HTMLElement, minutes: number): void => {
  const ribbon = slider.closest<HTMLElement>("[data-ribbon]") as HTMLElement;
  const next = shifted(blocksOf(ribbon), Number(slider.dataset.index), minutes);
  drawBlocks(ribbon, next);
  void saveRibbon(ribbon);
};
const initRibbon = (): void => {
  document.addEventListener("keydown", (event) => {
    const slider = (event.target as HTMLElement).closest<HTMLElement>("[data-ribbon] [role='slider']");
    if (!slider || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    moveBreak(slider, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 15));
  });
  document.addEventListener("pointerdown", (event) => {
    const slider = (event.target as HTMLElement).closest<HTMLElement>("[data-ribbon] [role='slider']");
    if (!slider) return;
    slider.focus({ preventScroll: true });
    const startX = event.clientX;
    let dx = 0;
    slider.setPointerCapture(event.pointerId);
    holdRefresh();
    const move = (e: PointerEvent): void => {
      dx = e.clientX - startX;
      slider.style.transform = `translateX(${dx}px)`;
    };
    const end = (e: Event): void => {
      slider.removeEventListener("pointermove", move);
      slider.removeEventListener("pointerup", end);
      slider.removeEventListener("pointercancel", end);
      slider.style.transform = "";
      releaseRefresh();
      const minutes = Math.round(dx / 5) * 5;
      if (e.type === "pointerup" && minutes) moveBreak(slider, minutes);
    };
    slider.addEventListener("pointermove", move);
    slider.addEventListener("pointerup", end);
    slider.addEventListener("pointercancel", end);
  });
  document.addEventListener("change", (event) => {
    const chooser = event.target as HTMLSelectElement;
    if (chooser.matches?.("[data-run-chooser]")) void softNavigate(`${location.pathname}?run=${chooser.value}`);
  });
};

// ---- Seats.
const seatsIn = (grid: HTMLElement): HTMLElement[] => $$(".seat", grid);
const ensureSeatStop = (grid: HTMLElement): void => {
  if (!$('[tabindex="0"]', grid)) (seatsIn(grid)[0] as HTMLElement | undefined)?.setAttribute("tabindex", "0");
};
let picked: { grid: HTMLElement; seat: string } | null = null;
const seatByLabel = (grid: HTMLElement, seat: string): HTMLElement => $<HTMLElement>(`[data-seat="${seat}"]`, grid) as HTMLElement;
const focusSeat = (grid: HTMLElement, seat: HTMLElement): void => {
  for (const each of seatsIn(grid)) each.tabIndex = -1;
  seat.tabIndex = 0;
  seat.focus();
};
const crossSeats = (grid: HTMLElement, from: string, to: string): void => {
  if (reducedMotion()) return;
  const a = seatByLabel(grid, from);
  const b = seatByLabel(grid, to);
  const boxA = a.getBoundingClientRect();
  const boxB = b.getBoundingClientRect();
  const x = boxB.left - boxA.left;
  const y = boxB.top - boxA.top;
  $(".seat-name", a)?.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }], { duration: 320, easing: EASE });
  $(".seat-name", b)?.animate([{ transform: `translate(${-x}px, ${-y}px)` }, { transform: "none" }], { duration: 320, easing: EASE });
};
const dropOn = async (grid: HTMLElement, fromLabel: string, toLabel: string): Promise<void> => {
  const from = seatByLabel(grid, fromLabel);
  const to = seatByLabel(grid, toLabel);
  const name = from.dataset.name as string;
  const other = to.dataset.name;
  const passenger = from.dataset.passenger as string;
  const reply = await safely(() => call("PUT", `/api/hires/${grid.dataset.hire}/seats`, { vehicleId: grid.dataset.vehicle, passengerId: passenger, seat: toLabel }));
  if (!reply.ok) return announce(reply.json?.error?.message ?? "That did not save. Try again.");
  announce(other ? `${name} is now in ${toLabel}. ${other} is now in ${fromLabel}.` : `${name} is now in ${toLabel}.`);
  await refreshNow();
  const again = seatByLabel(grid, toLabel);
  focusSeat(grid, again);
  crossSeats(grid, fromLabel, toLabel);
};
const initSeats = (): void => {
  document.addEventListener("keydown", (event) => {
    const seat = (event.target as HTMLElement).closest<HTMLElement>("[data-seat-grid] .seat");
    if (!seat) return;
    const grid = seat.closest<HTMLElement>("[data-seat-grid]") as HTMLElement;
    const row = seat.parentElement as HTMLElement;
    const rows = $$(".seat-row", grid);
    const across = $$(".seat", row);
    const y = rows.indexOf(row);
    const x = across.indexOf(seat);
    const all = seatsIn(grid);
    const moves: Record<string, () => HTMLElement | undefined> = {
      ArrowLeft: () => all[all.indexOf(seat) - 1], ArrowRight: () => all[all.indexOf(seat) + 1],
      ArrowUp: () => rows[y - 1] && $$(".seat", rows[y - 1])[x], ArrowDown: () => rows[y + 1] && ($$(".seat", rows[y + 1])[x] ?? $$(".seat", rows[y + 1]).pop()),
      Home: () => across[0], End: () => across[across.length - 1],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const next = moves[event.key]();
      if (next) focusSeat(grid, next);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (picked && picked.grid === grid) {
        const from = picked.seat;
        seatByLabel(grid, from).classList.remove("is-picked");
        picked = null;
        if (from !== seat.dataset.seat) void dropOn(grid, from, seat.dataset.seat as string);
      } else if (seat.dataset.passenger) {
        picked = { grid, seat: seat.dataset.seat as string };
        seat.classList.add("is-picked");
      }
    } else if (event.key === "Escape" && picked) {
      event.stopPropagation();
      seatByLabel(picked.grid, picked.seat).classList.remove("is-picked");
      picked = null;
    }
  });
  document.addEventListener("pointerdown", (event) => {
    const seat = (event.target as HTMLElement).closest<HTMLElement>("[data-seat-grid] .seat-taken");
    if (!seat) return;
    const grid = seat.closest<HTMLElement>("[data-seat-grid]") as HTMLElement;
    const token = $<HTMLElement>(".seat-name", seat) as HTMLElement;
    const startX = event.clientX;
    const startY = event.clientY;
    let lastX = startX;
    let lastY = startY;
    let cancelled = false;
    seat.setPointerCapture(event.pointerId);
    holdRefresh();
    const move = (e: PointerEvent): void => {
      if (cancelled) return;
      lastX = e.clientX;
      lastY = e.clientY;
      token.style.transform = `translate(${lastX - startX}px, ${lastY - startY}px)`;
    };
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      cancelled = true;
      token.style.transform = "";
    };
    const end = (e: Event): void => {
      seat.removeEventListener("pointermove", move);
      seat.removeEventListener("pointerup", end);
      seat.removeEventListener("pointercancel", end);
      document.removeEventListener("keydown", escape, true);
      token.style.transform = "";
      releaseRefresh();
      if (cancelled || e.type === "pointercancel") return;
      const target = document.elementsFromPoint(lastX, lastY).map((n) => n.closest<HTMLElement>(".seat")).find((n) => n && n !== seat && grid.contains(n));
      if (target) void dropOn(grid, seat.dataset.seat as string, target.dataset.seat as string);
    };
    seat.addEventListener("pointermove", move);
    seat.addEventListener("pointerup", end);
    seat.addEventListener("pointercancel", end);
    document.addEventListener("keydown", escape, true);
  });
};

// ---- Quote building.
let totalsAsked = 0;
const quoteBody = (form: HTMLElement): { seats: number; boughtPrice: string; marginPercent: string }[] =>
  $$("[data-vehicle]", form).map((row) => ({ seats: Number(row.dataset.seats), boughtPrice: row.dataset.bought as string, marginPercent: ($("[data-margin]", row) as HTMLInputElement).value }));
const initQuote = (): void => {
  document.addEventListener("input", (event) => {
    const field = event.target as HTMLInputElement;
    if (!field.matches?.("[data-margin]")) return;
    const form = field.closest<HTMLElement>("[data-quote]") as HTMLElement;
    form.setAttribute("data-local-dirty", "1");
    const mine = (totalsAsked += 1);
    clearProblems(form);
    void safely(() => call("POST", `/api/hires/${form.dataset.hire}/quote/preview`, { vehicles: quoteBody(form) })).then((reply) => {
      if (mine !== totalsAsked) return;
      if (!reply.ok) {
        showProblems(form, { marginPercent: reply.json?.error?.message ?? "Margin is 0 to 60 in steps of 0.5." }, undefined, false);
        return;
      }
      $$("[data-vehicle]", form).forEach((row, i) => {
        const v = reply.json.vehicles[i];
        for (const key of ["sellingPrice", "vat", "total", "deposit"]) {
          const cell = $(`[data-cell="${key}"]`, row);
          if (cell) cell.textContent = moneyOf(v[key]);
        }
      });
      const total = $("[data-total]", form);
      const deposit = $("[data-deposit-total]", form);
      if (total) total.textContent = moneyOf(reply.json.total);
      if (deposit) deposit.textContent = moneyOf(reply.json.depositTotal);
      announce(`Totals updated: ${moneyOf(reply.json.total)}.`, false);
    });
  });
  registerFlow("send-quote", async (form, button) => {
    const quote = $<HTMLElement>("[data-quote]") as HTMLElement;
    const hire = form.dataset.hire as string;
    clearProblems(form);
    setBusy(button);
    if (quote.hasAttribute("data-local-dirty")) {
      const saved = await safely(() => call("PUT", `/api/hires/${hire}/quote`, { version: Number(quote.dataset.version), vehicles: $$("[data-vehicle]", quote).map((row) => ({ id: row.dataset.vehicle, marginPercent: ($("[data-margin]", row) as HTMLInputElement).value })) }));
      if (!saved.ok) {
        clearBusy(button);
        if (saved.status === 412) $("[data-reload]")?.removeAttribute("hidden");
        return refusal(form, saved);
      }
      quote.dataset.version = String(saved.json.version);
    }
    const reply = await safely(() => call("POST", `/api/hires/${hire}/quote/send`, {}));
    clearBusy(button);
    if (!reply.ok) return refusal(form, reply);
    quote.removeAttribute("data-local-dirty");
    for (const field of $$<HTMLElement>("[data-margin]", quote)) delete field.dataset.dirty;
    form.setAttribute("data-close-on-ok", "");
    succeeded(form, "Quote sent.");
  });
};

// ---- Asks, merges, bids, lists.
const registerFlows = (): void => {
  const plainJson = async (form: HTMLFormElement, button: HTMLElement, method: string, path: string, body: unknown, ok: string | undefined): Promise<void> => {
    clearProblems(form);
    setBusy(button);
    const reply = await safely(() => call(method, path, body));
    clearBusy(button);
    if (!reply.ok) return refusal(form, reply);
    succeeded(form, ok);
  };
  registerFlow("ask", (form, button) => {
    const [method, path] = (form.dataset.api as string).split(" ");
    const chosen = $$<HTMLInputElement>('input[name="operatorIds"]:checked', form).map((i) => i.value);
    return plainJson(form, button, method, path, { operatorIds: chosen }, form.dataset.ok);
  });
  registerFlow("merge", (form, button) => {
    const [method, path] = (form.dataset.api as string).split(" ");
    const chosen = $$<HTMLInputElement>('input[name="merge"]:checked', form).map((i) => i.value);
    return plainJson(form, button, method, path, { enquiryIds: [form.dataset.current, ...chosen] }, form.dataset.ok);
  });
  registerFlow("bid", async (form, button) => {
    const token = form.dataset.token as string;
    const prices = $$<HTMLInputElement>("[data-bid-price]", form).map((i) => i.value);
    const changing = button.textContent?.trim() === "Change price";
    clearProblems(form);
    setBusy(button);
    const reply = await safely(() => call("PUT", `/api/b/${token}/bid`, { prices }));
    clearBusy(button);
    if (!reply.ok) {
      refusal(form, reply);
      return;
    }
    succeeded(form, changing ? "Price changed." : "Price sent.");
  });
  registerFlow("bring-in-list", async (form, button) => {
    const file = $<HTMLInputElement>('input[type="file"]', form)?.files?.[0];
    if (!file) return showProblems(form, { file: "Choose a file." });
    clearProblems(form);
    setBusy(button);
    const reply = await safely(async () => call("POST", (form.dataset.api as string).split(" ")[1], undefined, { body: await file.arrayBuffer(), headers: { "Content-Type": "text/csv" } }));
    clearBusy(button);
    if (!reply.ok) return refusal(form, reply);
    succeeded(form, `${reply.json.passengers.length} names brought in.`);
  });
  registerFlow("make-document", async (form, button) => {
    const hire = (form.elements.namedItem("hire") as HTMLSelectElement).value;
    const kind = form.elements.namedItem("kind") as HTMLSelectElement;
    if (!hire) return showProblems(form, { hire: "Choose a hire." });
    clearProblems(form);
    setBusy(button);
    const poll = window.setInterval(() => void refreshNow(), 400);
    const reply = await safely(() => call("POST", `/api/hires/${hire}/documents`, { kind: kind.value }));
    clearInterval(poll);
    clearBusy(button);
    if (!reply.ok) return refusal(form, reply);
    succeeded(form, `${kind.selectedOptions[0].textContent} stored.`);
  });
  initStatementFlow();
};

// ---- Statement preview.
const initStatementFlow = (): void => {
  let previewId = "";
  const section = (title: string, rows: string[]): HTMLElement | null => {
    if (!rows.length) return null;
    const wrap = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = title;
    const list = document.createElement("ul");
    list.className = "plain-list";
    for (const row of rows) { const item = document.createElement("li"); item.textContent = row; list.append(item); }
    wrap.append(heading, list);
    return wrap;
  };
  registerFlow("statement", async (form, button) => {
    const file = $<HTMLInputElement>('input[type="file"]', form)?.files?.[0];
    if (!file) return showProblems(form, { file: "Choose a file." });
    clearProblems(form);
    setBusy(button);
    const reply = await safely(async () => call("POST", "/api/payments/statements/preview", undefined, { body: await file.arrayBuffer(), headers: { "Content-Type": "text/csv" } }));
    clearBusy(button);
    const sheet = form.closest<HTMLElement>(".dialog") as HTMLElement;
    const preview = $("[data-preview]", sheet) as HTMLElement;
    const bringIn = $("[data-bring-in]", sheet) as HTMLElement;
    if (!reply.ok) {
      preview.hidden = true;
      bringIn.hidden = true;
      return refusal(form, reply);
    }
    const body = reply.json;
    previewId = body.previewId;
    const line = (r: ReplyBody): string => `Row ${r.row}: ${r.date}, ${r.description}, ${moneyOf(String(r.amount).replace("-", ""))}`;
    preview.replaceChildren(...[
      section("Matched", body.matched.map((r: ReplyBody) => `${line(r)}, ${r.reference}`)),
      section("Unmatched", body.unmatched.map(line)),
      section("Money out", body.moneyOut.map(line)),
      section("Already seen", body.alreadySeen.map(line)),
      section("Refused", body.refused.map((r: ReplyBody) => r.message)),
    ].filter((n): n is HTMLElement => n !== null));
    preview.hidden = false;
    bringIn.hidden = false;
    const count = body.matched.length + body.unmatched.length + body.moneyOut.length + body.alreadySeen.length + body.refused.length;
    announce(`Read ${count} rows.`, false);
  });
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-bring-in]");
    if (!button || button.dataset.pending) return;
    setBusy(button);
    void safely(() => call("POST", `/api/payments/statements/${previewId}/bring-in`, {})).then((reply) => {
      clearBusy(button);
      const sheet = button.closest<HTMLElement>(".dialog") as HTMLElement;
      if (!reply.ok) return announce(reply.json?.error?.message ?? "That did not save. Try again.");
      announce(`Brought in ${reply.json.broughtIn} rows.`);
      button.hidden = true;
      ($("[data-preview]", sheet) as HTMLElement).hidden = true;
      ($("form", sheet) as HTMLFormElement).reset();
      closeDialog(sheet);
      void refreshNow();
    });
  });
};

// ---- Changes: old and new side by side.
let changeAsked = 0;
const changeBody = (form: HTMLFormElement): Record<string, unknown> => {
  const built = collect(form).body;
  const out: Record<string, unknown> = {};
  const original = (name: string): string => (form.elements.namedItem(name) as HTMLInputElement).defaultValue;
  const dateField = form.elements.namedItem("departAt.date") as HTMLInputElement;
  const hour = form.elements.namedItem("departAt.hour") as HTMLSelectElement;
  const minutes = form.elements.namedItem("departAt.minutes") as HTMLSelectElement;
  const timeMoved = [...hour.options].find((o) => o.defaultSelected)?.value !== hour.value || [...minutes.options].find((o) => o.defaultSelected)?.value !== minutes.value;
  if (dateField.value !== original("departAt.date") || timeMoved) out.departAt = built.departAt;
  const stops = $$<HTMLInputElement>("[data-change-stop]", form);
  if (stops.some((s) => s.value !== s.defaultValue)) out.stops = stops.map((s) => s.value);
  out.vehicles = $$("[data-change-vehicle]", form).map((row) => ({
    id: row.dataset.changeVehicle, boughtPrice: ($("[data-change-bought]", row) as HTMLInputElement).value.replace(/,/g, ""), marginPercent: ($("[data-change-margin]", row) as HTMLInputElement).value,
  }));
  return out;
};
const drawSide = (side: HTMLElement, title: string, view: ReplyBody): void => {
  const heading = document.createElement("h3");
  heading.textContent = title;
  const when = document.createElement("p");
  when.textContent = `${longDate(view.departAt.date)}, ${view.departAt.time}`;
  const list = (rows: string[]): HTMLElement => {
    const ul = document.createElement("ul");
    ul.className = "plain-list";
    for (const row of rows) { const li = document.createElement("li"); li.textContent = row; ul.append(li); }
    return ul;
  };
  const total = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = moneyOf(view.total);
  total.append(strong);
  side.replaceChildren(heading, when, list(view.stops), list(view.vehicles.map((v: ReplyBody) => `${v.seats} seats, ${moneyOf(v.total)}`)), total);
};
const initChange = (): void => {
  let timer = 0;
  const preview = (form: HTMLFormElement): void => {
    const mine = (changeAsked += 1);
    void safely(() => call("POST", `/api/hires/${form.dataset.hire}/changes/preview`, changeBody(form))).then((reply) => {
      if (mine !== changeAsked || !reply.ok) return;
      const side = $<HTMLElement>('[data-change-side="new"]', form);
      if (side) drawSide(side, "New", reply.json.new);
    });
  };
  const watch = (event: Event): void => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-flow='change']");
    if (!form) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => preview(form), 120);
  };
  document.addEventListener("input", watch);
  document.addEventListener("change", watch);
  registerFlow("change", async (form, button) => {
    if (!collect(form).body.departAt.date) return showProblems(form, { departAt: "Enter a date as DD/MM/YYYY." });
    clearProblems(form);
    setBusy(button);
    const reply = await safely(() => call("POST", `/api/hires/${form.dataset.hire}/changes`, changeBody(form)));
    clearBusy(button);
    if (!reply.ok) return refusal(form, reply);
    succeeded(form, form.dataset.ok);
  });
};

// ---- Documents: each step's check drawn once.
const seenSteps = new Map<string, boolean>();
const drawChecks = (first: boolean): void => {
  for (const step of $$<HTMLElement>(".strip-step")) {
    const key = step.dataset.key as string;
    const done = step.dataset.stepDone === "1";
    const known = seenSteps.has(key);
    const was = seenSteps.get(key) ?? false;
    seenSteps.set(key, done);
    if (done && known && !was && !first && !reducedMotion()) {
      $(".strip-check", step)?.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 320, easing: EASE, fill: "both" });
    }
  }
};

export const initScreens = (): void => {
  initFilters();
  initStateBar();
  initTrip();
  initDiary();
  initRibbon();
  initSeats();
  initQuote();
  initChange();
  registerFlows();
  drawChecks(true);
  const sync = (): void => {
    for (const grid of $$("[data-week]")) ensureRove(grid);
    for (const grid of $$("[data-seat-grid]")) ensureSeatStop(grid);
    drawChecks(false);
  };
  afterRefresh(sync);
  sync();
};
