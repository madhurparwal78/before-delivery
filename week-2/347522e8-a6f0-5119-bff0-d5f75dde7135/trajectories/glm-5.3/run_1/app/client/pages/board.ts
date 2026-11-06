// The Board: rails, the pointer and keyboard sweep, holds, the docket and the
// 15-second refresh. All pricing comes from shared/hourPrice.ts so the draft
// shows exactly what the server debits (DP-47).

import { ApiFailure, apiJson, postJson, type User } from "../lib/api.js";
import { announce, clear, el, trapFocus } from "../lib/dom.js";
import { addDays, countdownText, hhmm, hhmmToMinutes, hours, isValidDate, minutesLeftText, prefersReducedMotion } from "../lib/clock.js";
import { priceSlots, type SlotWall } from "../../shared/hourPrice.js";
import { screenFrame, type AppCtx, type Navigate } from "../lib/shell.js";

type Block = {
  kind: "booking" | "hold" | "maintenance";
  start: string;
  end: string;
  starts_at: string;
  ends_at: string;
  buffer_ends_at: string;
  mine: boolean;
  booking_id: string | null;
  renter_business_name: string | null;
};

type Station = {
  id: string;
  name: string;
  hour_weight: number;
  off_peak_percent: number;
  overage_usd_per_hour: string;
  buffer_minutes: number;
  upcoming_settings: unknown[];
  blocks: Block[];
};

type StationsData = {
  date: string;
  time_zone: string;
  server_now: string;
  stations: Station[];
};

type Booking = {
  id: string;
  series_id: string;
  station_id: string;
  station_name: string;
  renter_id: string;
  status: string;
  date: string;
  start: string;
  end: string;
  starts_at: string;
  ends_at: string;
  buffer_minutes: number;
  buffer_ends_at: string;
  minutes_debited: number;
  hold_expires_at: string | null;
  cancellation_cutoff_at: string;
};

type RenterData = {
  balance_minutes: number;
  held_minutes: number;
  compliance: { state: string; coi_expires_on: string | null; card_expires_on: string | null };
};

const MIN = 60000;
const CELL_MINUTES = 15;
const CELLS = 96;
const MAX_SPAN = 360;
const POLL_MS = 15000;

const zoneAtNoon = (date: string): string => {
  const iso = Date.parse(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "short" }).formatToParts(
    new Date(iso),
  );
  const part = parts.find((p) => p.type === "timeZoneName");
  const value = part?.value ?? "CST";
  if (value === "GMT-5") return "CDT";
  if (value === "GMT-6") return "CST";
  return value;
};

// Prices a wall-clock range for one kitchen date, using the same slot
// definition the server uses. Off-peak slots come from wall-clock minutes.
const priceRange = (
  date: string,
  startMinutes: number,
  endMinutes: number,
  settings: { hourWeight: number; offPeakPercent: number },
): number => {
  const slots: { wallStart: SlotWall; fraction: number }[] = [];
  let cursor = startMinutes;
  while (cursor < endMinutes) {
    const slotEnd = Math.min(cursor + CELL_MINUTES, endMinutes);
    const wallStart = cursor % 1440;
    const offPeak = wallStart >= 22 * 60 || wallStart < 6 * 60;
    const unit = offPeak
      ? (15 * settings.hourWeight * settings.offPeakPercent) / 100
      : 15 * settings.hourWeight;
    // A slot that crosses 24:00 keeps its own wall-clock start.
    slots.push({ wallStart: { date, minutes: wallStart }, fraction: (slotEnd - cursor) / CELL_MINUTES });
    void unit;
    cursor = slotEnd;
  }
  return priceSlots(slots, settings);
};

export const renderBoard = async (mount: HTMLElement, ctx: AppCtx): Promise<void> => {
  const user = ctx.user as User;
  const navigate: Navigate = ctx.navigate;
  const staff = user.role === "operator" || user.role === "shift_lead";

  // The date query parameter is the only source of the shown day (DP-49).
  const shownDate = (): string => {
    const param = new URLSearchParams(window.location.search).get("date") ?? "";
    return isValidDate(param) ? param : ctx.today;
  };
  const setDate = (date: string, replace = false): void => {
    const url = `/board?date=${date}`;
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    void reload(true);
  };

  let data: StationsData | null = null;
  let renterData: RenterData | null = null;
  let liveHold: Booking | null = null;
  let selected: Booking | null = null;
  let serverNowMs = Date.now();
  let nowMinutes = 0;
  let timerId: number | null = null;
  let cancelled = false;

  type Draft = {
    station: Station;
    date: string;
    startMinutes: number;
    endMinutes: number;
    repeat: number;
    pending: boolean;
    shrunkFrom: number | null;
  };
  let draft: Draft | null = null;
  let repeatWeeks = 1;

  const announcer = el("div", {
    role: "status",
    id: "sweep-announcer",
    class: "status-live",
    "aria-live": "polite",
    "aria-label": "Sweep announcer",
  });
  const bookingStatus = el("div", {
    role: "status",
    id: "booking-status",
    class: "status-live",
    "aria-live": "polite",
    "aria-label": "Booking status",
  });

  const body = el("div", { class: "board-body" });

  const frame = screenFrame(user, navigate, body, "Board");

  // ---- date controls and day line ----
  const dayLine = el("p", { class: "day-line mono" }, "");
  const prev = el("button", { type: "button" }, "Previous day");
  const todayBtn = el("button", { type: "button" }, "Today");
  const next = el("button", { type: "button" }, "Next day");
  prev.addEventListener("click", () => setDate(addDays(shownDate(), -1)));
  next.addEventListener("click", () => setDate(addDays(shownDate(), 1)));
  todayBtn.addEventListener("click", () => setDate(ctx.today));
  const controls = el("div", { class: "date-controls" }, prev, todayBtn, next, dayLine);

  // ---- rails region ----
  const railsRegion = el("div", { role: "region", "aria-label": "Rails", class: "rails-region" });
  const railScroller = el("div", { class: "rail-scroller", tabindex: "0" });

  const buildRuler = (): HTMLElement => {
    const ruler = el("div", { class: "hour-ruler", role: "presentation" });
    for (let hour = 0; hour < 24; hour++) {
      ruler.append(el("span", { class: "ruler-mark" }, `${String(hour).padStart(2, "0")}:00`));
    }
    return ruler;
  };

  // ---- docket ----
  const docket = el("aside", { role: "complementary", "aria-label": "Docket", class: "docket" });
  const balanceLine = el("p", { class: "balance mono" });
  const pendingLine = el("p", { class: "pending mono" });
  const holdLine = el("p", { class: "hold-line mono" });
  const countdown = el("p", { class: "countdown mono", role: "timer" });
  const complianceLine = el("p", { class: "compliance-line" });
  const ticketLine = el("div", { class: "ticket-line" });
  const repeatInput = el("input", {
    type: "number",
    min: "1",
    max: "12",
    value: "1",
    class: "repeat-input",
    "aria-label": "Repeat weekly for",
  });
  const confirmBtn = el("button", { type: "button", disabled: true }, "Confirm booking");
  const releaseBtn = el("button", { type: "button", disabled: true }, "Release hold");
  const cancelBtn = el("button", { type: "button", disabled: true }, "Cancel booking");

  const docketRepeat = staff
    ? el("div")
    : el("div", { class: "docket-repeat" }, el("label", { for: "repeat-weeks" }, "Repeat weekly for"), repeatInput, el("span", {}, "week(s)"));
  repeatInput.id = "repeat-weeks";

  docket.append(balanceLine, pendingLine, holdLine, countdown, ticketLine, docketRepeat, confirmBtn, releaseBtn, cancelBtn, complianceLine, bookingStatus);

  const railWrap = el("div", { class: "rail-wrap" }, railsRegion, docket);
  body.append(controls, railWrap, announcer);

  const drawTicket = (options: {
    station: Station;
    startMinutes: number;
    endMinutes: number;
    minutes: number;
    kind: "draft" | "hold" | "confirmed" | "other" | "maintenance";
    business?: string | null;
    repeat?: number;
  }): HTMLElement => {
    void options.station;
    const height = Math.min(288, Math.max(12, ((options.endMinutes - options.startMinutes) / 15) * 12));
    const ticket = el("div", {
      class: `ticket ticket-${options.kind}`,
      style: `left:${(options.startMinutes / 1440) * 100}%;width:${((options.endMinutes - options.startMinutes) / 1440) * 100}%;height:${height}px`,
    });
    ticket.append(
      el("span", { class: "ticket-times mono" }, `${hhmm(options.startMinutes)}–${hhmm(options.endMinutes)}`),
      el("span", { class: "ticket-hours mono" }, `${hours(options.minutes)} h`),
    );
    if (options.kind === "hold") ticket.append(el("span", { class: "ticket-flag" }, "HOLD"));
    if (options.kind === "other") ticket.append(el("span", { class: "ticket-flag" }, "Booked"));
    if (options.kind === "maintenance") ticket.append(el("span", { class: "ticket-flag" }, "Maintenance"));
    if (options.business) ticket.append(el("span", { class: "ticket-business" }, options.business));
    if (options.repeat && options.repeat > 1) ticket.append(el("span", { class: "ticket-repeat" }, `× ${options.repeat} weeks`));
    return ticket;
  };

  const drawBuffer = (startMinutes: number, bufferMinutes: number): HTMLElement => {
    const tail = el("div", {
      class: "buffer-tail",
      role: "img",
      "aria-label": `Buffer until ${hhmm(startMinutes + bufferMinutes)}`,
      style: `left:${(startMinutes / 1440) * 100}%;width:${(bufferMinutes / 1440) * 100}%`,
    });
    return tail;
  };

  // Keyboard cells keep focus across re-renders: the grid is rebuilt on every
  // refresh, so the focused cell is captured before the rebuild and restored
  // afterwards. Without this, each render step would drop focus to the body.
  const renderRails = (): void => {
    const activeBefore = document.activeElement;
    const wasCell =
      activeBefore instanceof HTMLElement && activeBefore.classList.contains("rail-cell")
        ? {
            station: activeBefore.closest(".station-row")?.getAttribute("data-station") ?? null,
            minutes: activeBefore.getAttribute("data-minutes"),
          }
        : null;
    clear(railScroller);
    clear(railsRegion);
    if (!data) return;
    const hasAnyBlock = data.stations.some((station) => station.blocks.length > 0);
    const ruler = buildRuler();
    if (data.date === ctx.today) {
      ruler.append(
        el("span", {
          class: "now-line",
          role: "img",
          "aria-label": "Now",
          style: `left:${(nowMinutes / 1440) * 100}%`,
        }),
      );
    }
    railsRegion.append(ruler);

    for (const station of data.stations) {
      const stationRow = el("div", { class: "station-row", "data-station": station.id });
      stationRow.append(el("span", { class: "station-name" }, station.name));

      const track = el("div", { class: "rail-track" });
      const grid = el("div", { class: "rail", role: "grid", "aria-label": `${station.name} schedule` });
      const row = el("div", { role: "row", class: "rail-row" });
      for (let cell = 0; cell < CELLS; cell++) {
        const minutes = cell * 15;
        row.append(
          el("div", {
            role: "gridcell",
            class: "rail-cell",
            "aria-label": `${station.name} ${hhmm(minutes)}`,
            tabindex: "-1",
            "data-minutes": String(minutes),
          }),
        );
      }
      grid.append(row);
      grid.setAttribute("data-focusable", "cells");
      // The grid itself carries the tab stop; cells receive programmatic focus
      // so Tab reaches each station once (DP-14).
      grid.setAttribute("tabindex", "0");
      grid.addEventListener("focus", () => {
        const first = grid.querySelector<HTMLElement>('.rail-cell[data-minutes="360"]');
        first?.focus();
      });
      for (const cellEl of Array.from(grid.querySelectorAll<HTMLElement>(".rail-cell"))) {
        cellEl.setAttribute("tabindex", "-1");
      }

      for (const block of station.blocks) {
        const startMinutes = hhmmToMinutes(block.start) ?? 0;
        const endMinutes = hhmmToMinutes(block.end) ?? 0;
        if (block.kind === "maintenance") {
          track.append(
            drawTicket({
              station,
              startMinutes,
              endMinutes,
              minutes: endMinutes - startMinutes,
              kind: "maintenance",
            }),
          );
          continue;
        }
        if (station.buffer_minutes > 0) track.append(drawBuffer(endMinutes, station.buffer_minutes));
        if (block.mine && block.booking_id) {
          const mine = liveHold && block.booking_id === liveHold.id;
          const ticket = drawTicket({
            station,
            startMinutes,
            endMinutes,
            minutes: mine ? liveHold!.minutes_debited : 0,
            kind: mine ? "hold" : "confirmed",
          });
          ticket.setAttribute("role", "button");
          ticket.setAttribute("tabindex", "0");
          ticket.setAttribute(
            "aria-label",
            mine
              ? `Hold ${station.name} ${block.start} to ${block.end}`
              : `Booking ${station.name} ${block.start} to ${block.end}`,
          );
          ticket.addEventListener("click", () => {
            if (mine) {
              selected = liveHold;
              renderDocket();
            } else {
              void selectBooking(block.booking_id!);
            }
          });
          track.append(ticket);
        } else if (staff) {
          const other = drawTicket({
            station,
            startMinutes,
            endMinutes,
            minutes: endMinutes - startMinutes,
            kind: "other",
            business: block.renter_business_name,
          });
          other.setAttribute("role", "button");
          other.setAttribute("tabindex", "0");
          other.setAttribute(
            "aria-label",
            `${block.renter_business_name ?? ""} ${station.name} ${block.start} to ${block.end}`,
          );
          track.append(other);
        } else {
          const booked = drawTicket({
            station,
            startMinutes,
            endMinutes,
            minutes: endMinutes - startMinutes,
            kind: "other",
          });
          booked.setAttribute("role", "img");
          booked.setAttribute("aria-label", `Booked ${block.start} to ${block.end}`);
          track.append(booked);
        }
      }
      if (draft && draft.station.id === station.id && !draft.pending) {
        track.append(
          drawTicket({
            station,
            startMinutes: draft.startMinutes,
            endMinutes: draft.endMinutes,
            minutes: seriesTotal(draft),
            kind: "draft",
            repeat: draft.repeat,
          }),
        );
      }
      stationRow.append(track, grid);
      railScroller.append(stationRow);
    }

    railsRegion.append(railScroller);
    if (!hasAnyBlock && !draft) {
      railsRegion.append(el("p", { class: "empty-copy" }, "No bookings on this day."));
    }
    if (wasCell && wasCell.station !== null && wasCell.minutes !== null) {
      const next = railScroller.querySelector<HTMLElement>(
        `.station-row[data-station="${wasCell.station}"] .rail-cell[data-minutes="${wasCell.minutes}"]`,
      );
      next?.focus();
    }
  };

  const renderDocket = (): void => {
    if (staff) {
      balanceLine.textContent = "";
      pendingLine.textContent = "";
      holdLine.textContent = "";
      countdown.textContent = "";
    } else {
      const balance = renterData?.balance_minutes ?? 0;
      // The docket shows the projected balance while a draft is swept or its
      // hold is pending; once accepted the server already debited the price.
      const draftTotal = draft ? seriesTotal(draft) : 0;
      const shown = draft ? Math.max(0, balance - draftTotal) : balance;
      balanceLine.textContent = `Hour balance: ${hours(shown)} h`;
      pendingLine.textContent =
        renterData && renterData.held_minutes > 0 ? `Pending −${hours(renterData.held_minutes)} h` : "";
      if (liveHold) {
        holdLine.textContent = `Hold ${liveHold.station_name} ${liveHold.date} ${liveHold.start}–${liveHold.end}`;
        const expiresAt = Date.parse(liveHold.hold_expires_at ?? "");
        const drift = Date.now() - serverNowMs;
        const msLeft = expiresAt - Date.now() + drift;
        countdown.textContent = prefersReducedMotion() ? minutesLeftText(msLeft) : countdownText(msLeft);
        confirmBtn.disabled = false;
        releaseBtn.disabled = false;
      } else {
        holdLine.textContent = "";
        countdown.textContent = "";
        confirmBtn.disabled = true;
        releaseBtn.disabled = true;
      }
    }
    if (selected) {
      ticketLine.textContent = staff
        ? `${selected.station_name} ${selected.date} ${selected.start}–${selected.end}`
        : `${selected.station_name} ${selected.date} ${selected.start}–${selected.end} · ${hours(selected.minutes_debited)} h`;
      cancelBtn.disabled = staff ? true : selected.status !== "confirmed";
    } else {
      ticketLine.textContent = "";
      cancelBtn.disabled = true;
    }
    const compliance = renterData?.compliance;
    if (!staff && compliance) {
      if (compliance.state === "current") complianceLine.textContent = "Compliance: current";
      else if (compliance.state === "expiring")
        complianceLine.textContent = `Compliance: expires ${compliance.coi_expires_on ?? compliance.card_expires_on}`;
      else if (compliance.state === "lapsed") complianceLine.textContent = "Compliance: lapsed";
      else complianceLine.textContent = "Compliance: incomplete";
    } else {
      complianceLine.textContent = "";
    }
  };

  const seriesTotal = (d: Draft): number => {
    let total = 0;
    for (let week = 0; week < d.repeat; week++) {
      total += priceRange(addDays(d.date, week * 7), d.startMinutes, d.endMinutes, {
        hourWeight: d.station.hour_weight,
        offPeakPercent: d.station.off_peak_percent,
      });
    }
    return total;
  };

  const occupiedRanges = (station: Station): { start: number; end: number; buffer: number }[] =>
    station.blocks.map((block) => ({
      start: hhmmToMinutes(block.start) ?? 0,
      end: hhmmToMinutes(block.end) ?? 0,
      buffer: block.kind === "maintenance" ? 0 : station.buffer_minutes,
    }));

  // The legal end for a draft: stops at the first collision, the six-hour
  // limit, the end of day, and the balance. The same rules as the pointer
  // sweep apply to the keyboard sweep.
  const legalEndFor = (
    station: Station,
    date: string,
    startMinutes: number,
    wantEnd: number,
    repeat: number,
  ): { end: number; reason: string | null } => {
    const ranges = occupiedRanges(station);
    let candidate = Math.max(startMinutes + 15, Math.min(wantEnd, startMinutes + MAX_SPAN, 1440));
    let reason: string | null = null;
    if (wantEnd > startMinutes + MAX_SPAN && candidate === startMinutes + MAX_SPAN) {
      reason = "six hours is the longest booking";
    }
    if (wantEnd > 1440 && candidate === 1440) reason = reason ?? "the kitchen day ends at 24:00";
    for (const range of ranges) {
      const occupiedEnd = range.end + range.buffer;
      if (candidate > range.start && startMinutes < occupiedEnd) {
        const clamped = Math.min(candidate, range.start);
        if (clamped >= startMinutes + 15) {
          candidate = clamped;
          reason =
            startMinutes < range.end
              ? `another booking starts at ${hhmm(range.start)}`
              : range.buffer > 0
                ? `another booking's buffer runs until ${hhmm(occupiedEnd)}`
                : `maintenance starts at ${hhmm(range.start)}`;
        }
      }
    }
    const balance = renterData?.balance_minutes ?? 0;
    const seriesAt = (endMinutes: number): number =>
      seriesTotal({ station, date, startMinutes, endMinutes, repeat, pending: false, shrunkFrom: null });
    while (candidate > startMinutes + 15 && seriesAt(candidate) > balance) {
      candidate -= 15;
      reason = `your balance covers ${hours(balance)} hours`;
    }
    if (seriesAt(candidate) > balance) {
      return { end: startMinutes, reason: `your balance covers ${hours(balance)} hours` };
    }
    return { end: candidate, reason };
  };

  const announceStep = (d: Draft): void => {
    const price = seriesTotal(d);
    const bufferEnd = d.endMinutes + d.station.buffer_minutes;
    announce(
      announcer,
      `${d.station.name}, ${hhmm(d.startMinutes)} to ${hhmm(d.endMinutes)}, ${hours(price)} hours, buffer until ${hhmm(bufferEnd)}.`,
    );
  };

  const announceStop = (d: Draft, reason: string): void => {
    announce(announcer, `Can't extend past ${hhmm(d.endMinutes)}: ${reason}.`);
  };

  const reload = async (dayChanged: boolean): Promise<void> => {
    if (cancelled) return;
    const date = shownDate();
    try {
      const next = await apiJson<StationsData>(`/api/stations?date=${date}`);
      data = next;
      serverNowMs = Date.parse(next.server_now);
      nowMinutes = Math.floor((serverNowMs - Date.parse(`${next.date}T00:00:00Z`)) / MIN);
      window.__railsideToday = next.date;
      if (!staff && user.renter_id) {
        const renter = await apiJson<RenterData>(`/api/renters/${user.renter_id}`);
        renterData = renter;
        const bookings = await apiJson<{ bookings: Booking[] }>(`/api/bookings?status=hold`);
        const own = bookings.bookings
          .filter((b) => b.renter_id === user.renter_id && b.hold_expires_at)
          .sort((a, b) => Date.parse(b.hold_expires_at ?? "") - Date.parse(a.hold_expires_at ?? ""));
        liveHold = own.length > 0 ? own[0]! : null;
      }
      dayLine.textContent = `${date} · ${zoneAtNoon(date)}`;
      renderRails();
      renderDocket();
      void dayChanged;
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) navigate("/", true);
    }
  };

  const selectBooking = async (bookingId: string): Promise<void> => {
    try {
      const found = await apiJson<{ booking: Booking }>(`/api/bookings/${bookingId}`);
      selected = found.booking;
      renderDocket();
    } catch {
      selected = null;
      renderDocket();
    }
  };

  confirmBtn.addEventListener("click", async () => {
    if (!liveHold) return;
    confirmBtn.disabled = true;
    announce(bookingStatus, "Confirming…");
    try {
      await postJson(`/api/bookings/${liveHold.id}/confirm`, {});
      selected = null;
      liveHold = null;
      announce(bookingStatus, "Booking confirmed. A confirmation email is on its way.");
      await reload(false);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "hold_expired") {
        liveHold = null;
        announce(bookingStatus, "This hold ran out and the time was released.");
      } else {
        announce(bookingStatus, "Something went wrong. Try again.");
      }
      confirmBtn.disabled = false;
      await reload(false);
    }
  });

  releaseBtn.addEventListener("click", async () => {
    if (!liveHold) return;
    releaseBtn.disabled = true;
    announce(bookingStatus, "Releasing…");
    try {
      await postJson(`/api/bookings/${liveHold.id}/release`, {});
      const returned = liveHold.minutes_debited;
      liveHold = null;
      selected = null;
      announce(bookingStatus, `Hold released. ${hours(returned)} hours returned to your balance.`);
      await reload(false);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "hold_expired") {
        liveHold = null;
        announce(bookingStatus, "This hold ran out and the time was released.");
      } else {
        announce(bookingStatus, "Something went wrong. Try again.");
        releaseBtn.disabled = false;
      }
    }
  });

  cancelBtn.addEventListener("click", () => {
    if (!selected) return;
    const cutoff = Date.parse(selected.cancellation_cutoff_at);
    const credited = serverNowMs < cutoff;
    const outcomeLine = credited
      ? `Cancelling now returns ${hours(selected.minutes_debited)} hours.`
      : `Cancelling now forfeits ${hours(selected.minutes_debited)} hours.`;
    openCancelDialog(selected, outcomeLine, credited);
  });

  const openCancelDialog = (booking: Booking, outcomeLine: string, credited: boolean): void => {
    const dialog = el("div", { role: "alertdialog", "aria-label": "Cancel booking", class: "dialog" });
    const yes = el("button", { type: "button" }, "Yes, cancel");
    const keep = el("button", { type: "button" }, "Keep booking");
    dialog.append(el("p", {}, outcomeLine), yes, keep);
    const backdrop = el("div", { class: "dialog-backdrop" });
    const close = (): void => {
      backdrop.remove();
      cancelBtn.focus();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      trapFocus(dialog, event);
    };
    dialog.addEventListener("keydown", onKey);
    keep.addEventListener("click", close);
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      announce(bookingStatus, "Cancelling…");
      try {
        const result = await postJson<{ outcome: string; minutes: number }>(`/api/bookings/${booking.id}/cancel`, {});
        const message =
          result.outcome === "credited"
            ? `Booking cancelled. ${hours(result.minutes)} hours returned to your balance.`
            : `Booking cancelled. ${hours(result.minutes)} hours were forfeited because it was within 48 hours of the start.`;
        close();
        selected = null;
        announce(bookingStatus, message);
        void credited;
        await reload(false);
      } catch {
        yes.disabled = false;
        announce(bookingStatus, "Something went wrong. Try again.");
      }
    });
    backdrop.append(dialog);
    mount.append(backdrop);
    yes.focus();
  };

  // ---- pointer sweep ----
  railScroller.addEventListener("pointerdown", (event) => {
    if (staff) return;
    if (draft && draft.pending) return;
    const cell = (event.target as HTMLElement).closest(".rail-cell");
    if (!cell) return;
    const stationRow = (event.target as HTMLElement).closest(".station-row");
    if (!stationRow || !data) return;
    const stationName = stationRow.querySelector(".station-name")?.textContent ?? "";
    const station = data.stations.find((s) => s.name === stationName);
    if (!station) return;
    const minutes = Number(cell.getAttribute("data-minutes"));
    const taken = station.blocks.some((block) => {
      const start = hhmmToMinutes(block.start) ?? 0;
      const end = hhmmToMinutes(block.end) ?? 0;
      const occupiedEnd = block.kind === "maintenance" ? end : end + station.buffer_minutes;
      return minutes >= start && minutes < occupiedEnd;
    });
    const isPast = data.date === ctx.today && minutes * MIN + Date.parse(`${data.date}T00:00:00Z`) <= serverNowMs;
    if (taken || isPast || minutes >= 1440) {
      announce(announcer, "That time is taken.");
      return;
    }
    const legal = legalEndFor(station, shownDate(), minutes, minutes + 15, repeatWeeks);
    if (legal.end <= minutes) {
      announce(announcer, "That time is taken.");
      return;
    }
    draft = {
      station,
      date: shownDate(),
      startMinutes: minutes,
      endMinutes: legal.end,
      repeat: repeatWeeks,
      pending: false,
      shrunkFrom: null,
    };
    if (legal.reason) announceStop(draft, legal.reason);
    announceStep(draft);
    renderRails();
    renderDocket();

    const onMove = (moveEvent: PointerEvent): void => {
      if (!draft || draft.pending) return;
      const track = (moveEvent.target as HTMLElement).closest(".rail-track");
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = (moveEvent.clientX - rect.left) / rect.width;
      const raw = Math.round((Math.max(0, Math.min(1, ratio)) * 1440) / 15) * 15;
      const want = Math.max(draft.startMinutes + 15, raw);
      if (want === draft.endMinutes) return;
      const result = legalEndFor(draft.station, draft.date, draft.startMinutes, want, draft.repeat);
      if (result.end <= draft.startMinutes) return;
      const changed = result.end !== draft.endMinutes;
      draft.endMinutes = result.end;
      if (changed) {
        announceStep(draft);
        if (result.reason) announceStop(draft, result.reason);
        renderRails();
        renderDocket();
      }
    };
    const onUp = (): void => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      void placeHold();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  const placeHold = async (): Promise<void> => {
    if (!draft || draft.pending) return;
    draft.pending = true;
    announce(announcer, "Placing hold…");
    renderRails();
    renderDocket();
    try {
      const payload = {
        station_id: draft.station.id,
        date: draft.date,
        start: hhmm(draft.startMinutes),
        end: hhmm(draft.endMinutes),
        repeat_weeks: draft.repeat,
      };
      const result = await postJson<{ server_now: string; bookings: Booking[] }>("/api/bookings", payload);
      serverNowMs = Date.parse(result.server_now);
      liveHold = result.bookings[0] ?? null;
      selected = null;
      draft = null;
      announce(announcer, `Hold placed on ${liveHold?.station_name ?? ""} ${payload.start} to ${payload.end}. Confirm before the countdown ends.`);
      await reload(false);
    } catch (err) {
      draft = null;
      if (err instanceof ApiFailure) {
        if (err.code === "slot_conflict") {
          const legalEnd = err.body.legal_end ?? null;
          if (legalEnd) {
            announce(announcer, `Another renter claimed this time first. Your ticket now ends at ${legalEnd}.`);
          } else {
            announce(announcer, "Another renter claimed this time first. Your ticket was removed.");
          }
        } else if (err.code === "insufficient_hours") {
          announce(
            announcer,
            `You need ${hours(err.body.needed_minutes ?? 0)} hours and have ${hours(err.body.balance_minutes ?? 0)}. Buy a pack to continue.`,
          );
        } else if (err.code === "compliance_lapsed") {
          announce(announcer, "Bookings are paused until your certificate of insurance and food-handler card are current.");
        } else if (err.code === "renter_not_active") {
          announce(announcer, "Your account isn't active yet.");
        } else {
          announce(announcer, "Something went wrong. Try again.");
        }
      } else {
        announce(announcer, "Something went wrong. Try again.");
      }
      renderRails();
      renderDocket();
    }
  };

  // ---- keyboard sweep ----
  railScroller.addEventListener("keydown", (event) => {
    if (staff) return;
    const target = event.target as HTMLElement;
    const isCell = target.classList.contains("rail-cell");
    const stationRow = target.closest(".station-row");
    if (!isCell || !stationRow || !data) return;
    const stationName = stationRow.querySelector(".station-name")?.textContent ?? "";
    const station = data.stations.find((s) => s.name === stationName);
    if (!station) return;
    const minutes = Number(target.getAttribute("data-minutes"));

    const cellAt = (nextStation: Station, nextMinutes: number): HTMLElement | null =>
      railScroller
        .querySelectorAll(`.station-row[data-station="${nextStation.id}"] .rail-cell[data-minutes="${nextMinutes}"]`)
        .item(0) as HTMLElement | null;

    // Draft extension and shrinking come first, before plain arrows.
    if (event.shiftKey && event.key === "ArrowRight") {
      event.preventDefault();
      if (draft) {
        const result = legalEndFor(draft.station, draft.date, draft.startMinutes, draft.endMinutes + 15, draft.repeat);
        if (result.end > draft.startMinutes) {
          draft.endMinutes = result.end;
          announceStep(draft);
          if (result.reason) announceStop(draft, result.reason);
          renderRails();
          renderDocket();
        }
        return;
      }
      const taken = station.blocks.some((block) => {
        const start = hhmmToMinutes(block.start) ?? 0;
        const end = hhmmToMinutes(block.end) ?? 0;
        const occupiedEnd = block.kind === "maintenance" ? end : end + station.buffer_minutes;
        return minutes >= start && minutes < occupiedEnd;
      });
      if (taken) {
        announce(announcer, "That time is taken.");
        return;
      }
      draft = {
        station,
        date: shownDate(),
        startMinutes: minutes,
        endMinutes: minutes + 15,
        repeat: repeatWeeks,
        pending: false,
        shrunkFrom: null,
      };
      announceStep(draft);
      renderRails();
      renderDocket();
      return;
    }
    if (event.shiftKey && event.key === "ArrowLeft") {
      event.preventDefault();
      if (!draft) return;
      const next = draft.endMinutes - 15;
      if (next <= draft.startMinutes) {
        draft = null;
        renderRails();
        renderDocket();
        return;
      }
      draft.endMinutes = next;
      announceStep(draft);
      renderRails();
      renderDocket();
      return;
    }
    if (event.key === "Escape" && draft) {
      event.preventDefault();
      draft = null;
      renderRails();
      renderDocket();
      target.focus();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (draft) {
        void placeHold();
        return;
      }
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 15 : -15;
      const nextMinutes = Math.max(0, Math.min(1425, minutes + step));
      const nextCell = cellAt(station, nextMinutes);
      nextCell?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nextCell = cellAt(station, event.key === "Home" ? 0 : 1425);
      nextCell?.focus();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const index = data.stations.findIndex((s) => s.id === station.id);
      const nextIndex = Math.max(0, Math.min(data.stations.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      const nextCell = cellAt(data.stations[nextIndex]!, minutes);
      nextCell?.focus();
      return;
    }
  });

  repeatInput.addEventListener("change", () => {
    const value = Math.max(1, Math.min(12, Number((repeatInput as HTMLInputElement).value) || 1));
    (repeatInput as HTMLInputElement).value = String(value);
    repeatWeeks = value;
    if (!draft || draft.pending) {
      renderDocket();
      return;
    }
    draft.repeat = value;
    const balance = renterData?.balance_minutes ?? 0;
    while (draft.endMinutes > draft.startMinutes + 15 && seriesTotal(draft) > balance) {
      draft.endMinutes -= 15;
    }
    if (seriesTotal(draft) > balance) {
      draft = null;
      announce(announcer, `Can't extend past ${hhmm(0)}: your balance covers ${hours(balance)} hours.`);
      renderRails();
      renderDocket();
      return;
    }
    announceStep(draft);
    renderRails();
    renderDocket();
  });

  const tick = (): void => {
    if (cancelled) return;
    renderDocket();
  };
  timerId = window.setInterval(() => {
    void reload(false);
  }, POLL_MS);
  window.setInterval(tick, 1000);

  mount.append(frame);
  if (!isValidDate(new URLSearchParams(window.location.search).get("date") ?? "")) {
    window.history.replaceState({}, "", `/board?date=${ctx.today}`);
  }
  await reload(true);
  const firstCell = railScroller.querySelector<HTMLElement>(".rail-cell[data-minutes='360']");
  if (firstCell) firstCell.focus();
  const disconnect = (): void => {
    cancelled = true;
    if (timerId !== null) window.clearInterval(timerId);
  };
  mount.addEventListener("railside-unmount", disconnect);
};

