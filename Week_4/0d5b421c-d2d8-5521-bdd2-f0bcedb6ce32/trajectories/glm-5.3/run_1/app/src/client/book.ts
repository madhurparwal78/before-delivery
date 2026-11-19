import {
  apiJson, ApiFailure, escapeHtml, euro, formatCountdown, idemKey, lisbonDayStamp,
  lisbonToday, localTimeZone, localTimeParts, openEvents, renderBanners, ServerClock,
  watchStatus, type FloorResponse, type StatusResponse,
} from "./shared.js";

interface Slot {
  time: string;
  starts_at: string;
  bookable: boolean;
  reason: null | "too_late" | "past" | "beyond_horizon";
  covers_free: number;
  eligible_tables: number;
}

interface AvailabilityResponse {
  date: string;
  party_size: number;
  server_now: string;
  slots: Slot[];
}

interface PlanTable {
  table_id: string;
  room_id: string;
  min_seats: number;
  max_seats: number;
  status: "fits" | "not_for_party" | "taken";
}

interface PlanResponse {
  date: string;
  time: string;
  party_size: number;
  tables: PlanTable[];
  pairs: { pair_id: string; status: "fits" | "not_for_party" | "taken" }[];
}

interface HoldResponse {
  hold_id: string;
  table_id: string;
  date: string;
  time: string;
  party_size: number;
  status: "live" | "expired" | "released" | "confirmed";
  expires_at: string;
  server_now: string;
  deposit_cents: number;
}

interface RulesResponse {
  slot_times: string[];
  booking_horizon_days: number;
  hold_seconds: number;
}

interface Booking {
  reference: string;
  status: string;
  source: string;
  date: string;
  time: string;
  starts_at: string;
  party_size: number;
  table_id: string;
  room: string;
  name: string;
  deposit: { amount_cents: number; state: string };
}

interface ConfirmResponse {
  booking: Booking;
  manage_url: string;
}

const SLOT_LABEL_NOT_BOOKABLE = "too late to book online";

const clock = new ServerClock();
let rules: RulesResponse | null = null;
let floor: FloorResponse | null = null;

interface Choice {
  party: number;
  date: string;
  time: string | null;
}

let choice: Choice = { party: 2, date: lisbonToday(), time: null };
let heldTableId: string | null = null;
let hold: HoldResponse | null = null;
let holdCountdownTimer: number | null = null;
let pendingPlanToken = 0;

const els = {
  summary: document.getElementById("summary-line") as HTMLElement,
  partyRow: document.getElementById("party-row") as HTMLElement,
  dateInput: document.getElementById("date-input") as HTMLInputElement,
  slotList: document.getElementById("slot-list") as HTMLElement,
  plan: document.getElementById("plan") as HTMLElement,
  planState: document.getElementById("plan-state") as HTMLElement,
  yourTable: document.getElementById("your-table") as HTMLElement,
  tablesListbox: document.getElementById("tables-listbox") as HTMLElement,
  waitlistLink: document.getElementById("waitlist-link") as HTMLAnchorElement,
  statusRegion: document.getElementById("status-region") as HTMLElement,
  bannerSlot: document.getElementById("banner-slot") as HTMLElement,
};

const params = new URLSearchParams(location.search);

function summaryLine(): void {
  const d = new Date(`${choice.date}T12:00:00Z`);
  const day = lisbonDayStamp(d);
  const guests = choice.party === 1 ? "1 guest" : `${choice.party} guests`;
  els.summary.textContent = choice.time
    ? `${day} · ${choice.time} · ${guests}`
    : `${day} · ${guests}`;
}

function syncUrl(replace = false): void {
  const q = new URLSearchParams();
  q.set("date", choice.date);
  q.set("party", String(choice.party));
  if (choice.time) q.set("time", choice.time);
  const url = `${location.pathname}?${q.toString()}`;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
}

/** Apply the published defaults: bad party becomes 2, bad date becomes today. */
function normaliseInputs(): void {
  const partyRaw = Number(params.get("party"));
  if (Number.isInteger(partyRaw) && partyRaw >= 1 && partyRaw <= 8) choice.party = partyRaw;
  const dateRaw = params.get("date") ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) choice.date = dateRaw;
  const timeRaw = params.get("time") ?? "";
  choice.time = null;
  void timeRaw; // validated against the slot list once it loads
  pendingTimeFromUrl = timeRaw !== "" ? timeRaw : null;
  syncUrl(true);
}

let pendingTimeFromUrl: string | null = null;

function renderPartyRow(): void {
  els.partyRow.innerHTML = Array.from({ length: 8 }, (_, i) => i + 1).map((n) => `
    <label>
      <input type="radio" name="party" value="${n}" ${n === choice.party ? "checked" : ""}>
      <span>${n === 1 ? "1 guest" : `${n} guests`}</span>
    </label>`).join("");
  for (const input of Array.from(els.partyRow.querySelectorAll<HTMLInputElement>("input[type=radio]"))) {
    input.addEventListener("change", () => {
      if (input.checked) void changeChoice({ party: Number(input.value) }, input);
    });
    input.addEventListener("keydown", (e) => {
      const radios = Array.from(els.partyRow.querySelectorAll<HTMLInputElement>("input[type=radio]"));
      const idx = radios.indexOf(input);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = radios[(idx + 1) % radios.length];
        next.checked = true;
        next.focus();
        next.dispatchEvent(new Event("change"));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = radios[(idx - 1 + radios.length) % radios.length];
        prev.checked = true;
        prev.focus();
        prev.dispatchEvent(new Event("change"));
      }
    });
  }
}

async function loadAvailability(): Promise<AvailabilityResponse> {
  const url = `/api/availability?date=${encodeURIComponent(choice.date)}&party=${choice.party}`;
  const a = await apiJson<AvailabilityResponse>(url);
  clock.sync(a.server_now);
  return a;
}

function slotRowLabel(slot: Slot): { main: string; suffix: string; disabled: boolean } {
  const tz = localTimeZone();
  const instant = new Date(`${slot.starts_at}`);
  let main = slot.time;
  if (tz) {
    const local = localTimeParts(instant, tz);
    main += ` (${local.time}${local.dayDiffers ? ` ${new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(instant)}` : ""} your time)`;
  }
  if (!slot.bookable) {
    return { main: `${slot.time}…`, suffix: SLOT_LABEL_NOT_BOOKABLE, disabled: true };
  }
  let suffix = `${slot.covers_free} covers free`;
  if (slot.eligible_tables === 0) suffix += ", waitlist only";
  return { main, suffix, disabled: false };
}

async function renderSlots(): Promise<void> {
  const availability = await loadAvailability();
  const items = availability.slots.map((slot) => {
    const { main, suffix, disabled } = slotRowLabel(slot);
    const selected = choice.time === slot.time;
    return `<li>
      <button type="button" class="slot-row" role="option" data-time="${slot.time}"
        aria-selected="${selected}" ${disabled ? "disabled" : ""}>
        <span class="time">${escapeHtml(main)}</span>
        <span class="covers">${escapeHtml(suffix)}</span>
      </button>
    </li>`;
  }).join("");
  els.slotList.innerHTML = items;

  // Keep a pending time from the URL if it is still bookable.
  if (pendingTimeFromUrl !== null) {
    const slot = availability.slots.find((s) => s.time === pendingTimeFromUrl && s.bookable);
    pendingTimeFromUrl = null;
    if (slot) {
      choice.time = slot.time;
      syncUrl(true);
      await chooseTime(slot.time, null, true);
    }
  }

  for (const btn of Array.from(els.slotList.querySelectorAll<HTMLButtonElement>("button.slot-row"))) {
    btn.addEventListener("click", () => { void chooseTime(btn.dataset.time ?? null, btn, false); });
    btn.addEventListener("keydown", (e) => {
      const rows = Array.from(els.slotList.querySelectorAll<HTMLButtonElement>("button.slot-row"));
      const idx = rows.indexOf(btn);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        for (let j = idx + 1; j < rows.length; j++) { if (!rows[j].disabled) { rows[j].focus(); break; } }
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        for (let j = idx - 1; j >= 0; j--) { if (!rows[j].disabled) { rows[j].focus(); break; } }
      } else if (e.key === "Home") {
        e.preventDefault();
        const first = rows.find((r) => !r.disabled);
        first?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        for (let j = rows.length - 1; j >= 0; j--) { if (!rows[j].disabled) { rows[j].focus(); break; } }
      } else if (e.key === "Enter" || e.key === " ") {
        if (!btn.disabled) { e.preventDefault(); void chooseTime(btn.dataset.time ?? null, btn, false); }
      }
    });
  }
  summaryLine();
  updateWaitlistLink();
}

function updateWaitlistLink(): void {
  const q = new URLSearchParams();
  q.set("date", choice.date);
  q.set("party", String(choice.party));
  const earliest = choice.time ?? "18:00";
  const latest = choice.time ?? "22:00";
  q.set("earliest", earliest);
  q.set("latest", latest);
  els.waitlistLink.href = `/waitlist?${q.toString()}`;
}

/** Changing party, date or time while holding: release first, then reload. */
async function changeChoice(
  next: Partial<Choice>, control: HTMLElement | null,
): Promise<void> {
  const previous = { ...choice };
  const merged: Choice = { ...choice, ...next };
  // Decide whether the chosen time is kept.
  if (hold && holdTableLive()) {
    const ok = await releaseHold(false);
    if (!ok) {
      // The change is not applied; the outage banner appears.
      const partyInputs = els.partyRow.querySelectorAll<HTMLInputElement>("input[type=radio]");
      for (const p of partyInputs) p.checked = Number(p.value) === previous.party;
      els.dateInput.value = previous.date;
      renderBannerNow();
      return;
    }
  }
  choice = { party: merged.party, date: merged.date, time: merged.time ?? choice.time };
  // When party or date changes, the chosen time is kept if still bookable.
  if (next.party !== undefined || next.date !== undefined) {
    if (choice.time !== null) {
      try {
        const a = await loadAvailability();
        const still = a.slots.find((s) => s.time === choice.time && s.bookable);
        if (!still) choice.time = null;
      } catch { choice.time = null; }
    }
  }
  if (next.time !== undefined) choice.time = next.time ?? null;
  syncUrl(next.time === undefined && next.party === undefined && next.date === undefined);
  summaryLine();
  await reloadForChoice(control);
}

async function reloadForChoice(control: HTMLElement | null): Promise<void> {
  try {
    await renderSlots();
  } catch { /* availability failed; keep list */ }
  await renderPlan();
  if (control) control.focus();
}

/** Choose a slot. Choosing the slot that is already chosen does nothing. */
async function chooseTime(time: string | null, control: HTMLElement | null, fromUrl: boolean): Promise<void> {
  if (time === null) return;
  if (choice.time === time && !fromUrl) return;
  if (hold && holdTableLive()) {
    const ok = await releaseHold(false);
    if (!ok) {
      renderBannerNow();
      return;
    }
  }
  choice.time = time;
  if (!fromUrl) syncUrl();
  summaryLine();
  updateWaitlistLink();
  await renderPlan();
  if (control) control.focus();
}

function renderBannerNow(): void {
  void apiJson<StatusResponse>("/api/status").then((s) => renderBanners(els.bannerSlot, s, false)).catch(() => undefined);
}

// ===== Floor plan =====

function seatPositions(maxSeats: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const radius = 38;
  for (let i = 0; i < maxSeats; i++) {
    const angle = (2 * Math.PI * i) / maxSeats - Math.PI / 2;
    out.push({ x: 50 + radius * Math.cos(angle), y: 44 + radius * Math.sin(angle) });
  }
  return out;
}

async function renderPlan(): Promise<void> {
  if (!choice.time) {
    els.plan.innerHTML = "";
    els.planState.textContent = "";
    renderTablesListbox(null, null);
    return;
  }
  const token = ++pendingPlanToken;
  els.planState.textContent = "Laying out the room...";
  let plan: PlanResponse;
  try {
    plan = await apiJson<PlanResponse>(
      `/api/plan?date=${encodeURIComponent(choice.date)}&time=${encodeURIComponent(choice.time)}&party=${choice.party}`,
    );
  } catch {
    if (token !== pendingPlanToken) return;
    els.planState.textContent = "We couldn't load the floor plan. Refresh to try again.";
    return;
  }
  if (token !== pendingPlanToken) return;
  els.planState.textContent = "";
  if (!floor) return;

  const tableById = new Map(plan.tables.map((t) => [t.table_id, t]));
  const pairById = new Map((plan.pairs ?? []).map((p) => [p.pair_id, p]));
  const html = floor.rooms.map((room) => {
    const cells = room.tables.map((t) => {
      // For parties of 7 or 8, the pair cell is drawn instead of its two tables.
      const pair = floor?.joinable_pairs.find((p) => p.tables.includes(t.table_id));
      if (choice.party >= 7 && pair && pairById.has(pair.pair_id)) {
        if (pair.tables[0] !== t.table_id) return "";
        const p = pairById.get(pair.pair_id);
        if (!p) return "";
        const held = heldTableId === p.pair_id;
        const state = held ? "Held by you" : p.status === "fits" ? "Fits your party" : p.status === "taken" ? "Taken" : "Not for your party";
        return `<div class="table-cell" data-round="false" data-table="${p.pair_id}" style="width: 190px;">
          <button type="button" class="table-btn status-${held ? "held" : p.status}"
            data-table="${p.pair_id}" data-status="${held ? "held" : p.status}" aria-label="Tables ${pair.tables[0]} and ${pair.tables[1]} joined, ${room.name}, ${pair.min_seats} to ${pair.max_seats} seats, ${state}">
            <span class="tid">${pair.tables[0]}+${pair.tables[1]}</span>
            <span class="seats">${pair.min_seats} to ${pair.max_seats} seats</span>
            <span class="state">${state}</span>
            <span class="marks">${seatPositions(pair.max_seats).map((s) => `<span class="seatmark" style="left:${s.x}%; top:${s.y}%"></span>`).join("")}</span>
          </button>
        </div>`;
      }
      const status = tableById.get(t.table_id)?.status ?? "not_for_party";
      const round = t.max_seats <= 2;
      const held = heldTableId === t.table_id;
      const seats = seatPositions(t.max_seats);
      const seatMarks = seats.map((s) => `<span class="seatmark" style="left:${s.x}%; top:${s.y}%"></span>`).join("");
      const state = held ? "Held by you" : status === "fits" ? "Fits your party" : status === "taken" ? "Taken" : "Not for your party";
      return `<div class="table-cell" data-round="${round}" data-table="${t.table_id}">
        <button type="button" class="table-btn ${round ? "round" : ""} status-${held ? "held" : status}"
          data-table="${t.table_id}" data-status="${held ? "held" : status}" aria-label="Table ${t.table_id}, ${room.name}, ${t.min_seats} to ${t.max_seats} seats, ${state}">
          <span class="tid">${t.table_id}</span>
          <span class="seats">${t.min_seats} to ${t.max_seats} seats</span>
          <span class="state">${state}</span>
          <span class="marks">${seatMarks}</span>
        </button>
      </div>`;
    }).join("");
    return `<div class="plan-room">
      <h3>${escapeHtml(room.name)}</h3>
      <div class="plan-canvas">${cells}</div>
    </div>`;
  }).join("");
  els.plan.innerHTML = html;

  // Place settings and ring on the held table.
  if (hold && heldTableId) renderHoldVisual(heldTableId, hold.party_size);

  for (const btn of Array.from(els.plan.querySelectorAll<HTMLButtonElement>("button.table-btn"))) {
    btn.addEventListener("click", () => { void pickTable(btn.dataset.table ?? "", btn); });
  }
  wirePlanKeyboard();
  renderTablesListbox(plan, heldTableId);
}

function renderTablesListbox(plan: PlanResponse | null, held: string | null): void {
  if (!floor || !plan) { els.tablesListbox.innerHTML = ""; return; }
  const tableById = new Map(plan.tables.map((t) => [t.table_id, t]));
  const pairStatus = new Map((plan.pairs ?? []).map((p) => [p.pair_id, p.status]));
  const options = floor.rooms.map((room) => room.tables.map((t) => {
    const status = tableById.get(t.table_id)?.status ?? "not_for_party";
    const label = held === t.table_id ? "Held by you" : status === "fits" ? "Fits your party" : status === "taken" ? "Taken" : "Not for your party";
    return `<div role="option" aria-selected="${held === t.table_id ? "true" : "false"}" aria-label="Table ${t.table_id}, ${room.name}, ${t.min_seats} to ${t.max_seats} seats, ${label}" data-table="${t.table_id}"></div>`;
  }).join("")).join("");
  // Joined pairs appear as options only for parties of 7 or 8.
  let pairOptions = "";
  if (choice.party >= 7) {
    for (const p of floor.joinable_pairs) {
      const status = pairStatus.get(p.pair_id) ?? "not_for_party";
      const label = held === p.pair_id ? "Held by you" : status === "fits" ? "Fits your party" : status === "taken" ? "Taken" : "Not for your party";
      const room = roomNameOf(p.tables[0]);
      const [a, b] = p.tables;
      pairOptions += `<div role="option" aria-selected="${held === p.pair_id ? "true" : "false"}" aria-label="Tables ${a} and ${b} joined, ${room}, ${p.min_seats} to ${p.max_seats} seats, ${label}" data-table="${p.pair_id}"></div>`;
    }
  }
  els.tablesListbox.innerHTML = options + pairOptions;
}

/** Arrow keys move around the plan in seed order, wrapping. */
function wirePlanKeyboard(): void {
  const btns = Array.from(els.plan.querySelectorAll<HTMLButtonElement>("button.table-btn"));
  for (const btn of btns) {
    btn.addEventListener("keydown", (e) => {
      const order = planOrder();
      const idx = order.indexOf(btn.dataset.table ?? "");
      const move = (delta: number): void => {
        e.preventDefault();
        const nextId = order[(idx + delta + order.length) % order.length];
        const next = btns.find((b) => b.dataset.table === nextId);
        next?.focus();
      };
      if (e.key === "ArrowRight" || e.key === "ArrowDown") move(1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(-1);
      else if (e.key === "Home") { e.preventDefault(); btns[0]?.focus(); }
      else if (e.key === "End") { e.preventDefault(); btns[btns.length - 1]?.focus(); }
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void pickTable(btn.dataset.table ?? "", btn);
      }
    });
  }
  // Tab enters the plan on the first table that fits the party, or the first table.
  const firstFit = btns.find((b) => b.dataset.status === "fits") ?? btns[0];
  if (firstFit) firstFit.setAttribute("tabindex", "0");
  for (const b of btns) { if (b !== firstFit) b.setAttribute("tabindex", "-1"); }
}

function planOrder(): string[] {
  if (!floor) return [];
  if (choice.party >= 7) {
    // The pair cells replace their tables on the plan for parties of 7 or 8.
    return floor.rooms.flatMap((r) => r.tables.map((t) => t.table_id))
      .map((id) => {
        const pair = floor?.joinable_pairs.find((p) => p.tables.includes(id));
        if (pair && pair.tables[0] === id) return pair.pair_id;
        if (pair) return "";
        return id;
      })
      .filter((id) => id !== "");
  }
  return floor.rooms.flatMap((r) => r.tables.map((t) => t.table_id));
}

/** The room name of a table id, used for accessible pair labels. */
function roomNameOf(tableId: string): string {
  const room = floor?.rooms.find((r) => r.tables.some((t) => t.table_id === tableId));
  return room?.name ?? "";
}

// ===== Holds =====

function holdTableLive(): boolean {
  if (!hold) return false;
  return hold.status === "live" && clock.now().getTime() < new Date(hold.expires_at).getTime();
}

async function pickTable(tableId: string, btn: HTMLButtonElement): Promise<void> {
  const status = btn.dataset.status ?? "";
  if (status === "taken") {
    announce(`Table ${tableId} was just taken. Pick another table.`);
    return;
  }
  if (status === "not_for_party") {
    announce(`That table isn't set for your party. Pick an outlined table.`);
    return;
  }
  if (heldTableId === tableId && holdTableLive()) return;

  // Choosing a different table releases the current hold first.
  if (hold && holdTableLive() && heldTableId !== tableId) {
    const ok = await releaseHold(false);
    if (!ok) { renderBannerNow(); return; }
  }

  announce(`Holding table ${tableId}...`);
  let resp: HoldResponse;
  try {
    resp = await apiJson<HoldResponse>("/api/holds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: choice.date, time: choice.time, party_size: choice.party, table_id: tableId,
      }),
    });
  } catch (e) {
    if (e instanceof ApiFailure) {
      if (e.status === 503) { renderBannerNow(); announce("Table holds are paused. Please try again in a few minutes."); return; }
      if (e.code === "table_taken") {
        btn.dataset.status = "taken";
        btn.classList.remove("status-fits");
        btn.classList.add("status-taken");
        const state = btn.querySelector(".state");
        if (state) state.textContent = "Taken";
        announce(`Table ${tableId} was just taken. Pick another table.`);
        await renderPlan();
        return;
      }
      if (e.code === "table_not_for_party") {
        announce(`That table isn't set for your party. Pick an outlined table.`);
        return;
      }
      if (e.code === "slot_not_bookable") {
        announce(`That time can't be booked online any more. Pick another time.`);
        await renderSlots();
        return;
      }
    }
    announce("We couldn't hold that table. Please try again.");
    return;
  }
  clock.sync(resp.server_now);
  hold = resp;
  heldTableId = resp.table_id;
  holdEndedHandled = false;
  renderYourTable();
  await renderPlan();
  announce(`Table ${resp.table_id} is held for you.`);
}

/** Release the current hold; returns false when the server refuses. */
async function releaseHold(announceIt: boolean): Promise<boolean> {
  if (!hold || !heldTableId) return true;
  const holdId = hold.hold_id;
  try {
    await apiJson(`/api/holds/${holdId}`, { method: "DELETE" });
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 503) {
      renderBannerNow();
      return false;
    }
    if (e instanceof ApiFailure && (e.status === 410 || e.status === 409)) {
      // The hold ended anyway.
    } else {
      return false;
    }
  }
  hold = null;
  const released = heldTableId;
  heldTableId = null;
  stopCountdown();
  renderYourTable();
  await renderPlan();
  if (announceIt && released) {
    announce(`Table ${released} released.`);
    const btn = els.plan.querySelector<HTMLButtonElement>(`button.table-btn[data-table="${released}"]`);
    btn?.focus();
  } else if (released && !announceIt) {
    announce(`Table ${released} released.`);
  }
  return true;
}

function stopCountdown(): void {
  if (holdCountdownTimer !== null) {
    clearInterval(holdCountdownTimer);
    holdCountdownTimer = null;
  }
}

/** The lay: settings appear clockwise after the 201, with the draining ring. */
function renderHoldVisual(tableId: string, partySize: number): void {
  const cell = els.plan.querySelector<HTMLElement>(`.table-cell[data-table="${tableId}"]`);
  if (!cell || !hold) return;
  const btn = cell.querySelector<HTMLButtonElement>("button.table-btn");
  if (!btn) return;
  btn.classList.remove("status-fits", "status-taken", "status-not_for_party");
  btn.classList.add("status-held");
  btn.dataset.status = "held";
  const state = btn.querySelector(".state");
  if (state) state.textContent = "Held by you";

  // Remove leftover settings then lay N place settings clockwise from twelve o'clock.
  for (const old of Array.from(cell.querySelectorAll(".place"))) old.remove();
  const seats = seatPositions(btnMaxSeats(tableId));
  const marks = Array.from(cell.querySelectorAll(".seatmark"));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const laySetting = (k: number): void => {
    const pos = seats[(k - 1) % seats.length];
    const place = document.createElement("span");
    place.className = "place";
    place.setAttribute("role", "img");
    place.setAttribute("aria-label", `Place setting ${k} of ${partySize}, table ${tableId}`);
    place.style.left = `${pos.x}%`;
    place.style.top = `${pos.y}%`;
    cell.appendChild(place);
  };

  const ring = document.createElement("span");
  ring.className = "holdring";
  cell.appendChild(ring);

  const drawRing = (): void => {
    const remaining = Math.max(0, new Date(hold?.expires_at ?? "").getTime() - clock.now().getTime());
    const totalMs = (rules?.hold_seconds ?? 300) * 1000;
    const fraction = Math.min(1, remaining / totalMs);
    ring.style.setProperty("background",
      `conic-gradient(var(--lime) ${fraction * 360}deg, transparent ${fraction * 360}deg)`);
    ring.style.setProperty("opacity", fraction > 0 ? "0.9" : "0");
  };

  if (reduced) {
    for (let k = 1; k <= partySize; k++) laySetting(k);
  } else {
    for (let k = 1; k <= partySize; k++) {
      window.setTimeout(() => laySetting(k), (k - 1) * 70);
    }
  }
  for (let i = partySize; i < marks.length; i++) {
    marks[i].classList.add("unused");
  }
  drawRing();
}

function btnMaxSeats(tableId: string): number {
  return floor?.rooms.flatMap((r) => r.tables).find((t) => t.table_id === tableId)?.max_seats ?? 2;
}

/** The lift-off: settings leave counter-clockwise on the hold-expired event. */
function liftOff(tableId: string): void {
  const cell = els.plan.querySelector<HTMLElement>(`.table-cell[data-table="${tableId}"]`);
  if (!cell) return;
  const places = Array.from(cell.querySelectorAll<HTMLElement>(".place")).reverse();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const removeOne = (el: HTMLElement): void => el.remove();
  if (reduced) {
    for (const p of places) p.remove();
  } else {
    places.forEach((p, i) => {
      p.classList.add("removing");
      window.setTimeout(() => removeOne(p), i * 40 + 180);
    });
  }
  for (const ring of Array.from(cell.querySelectorAll(".holdring"))) ring.remove();
  const btn = cell.querySelector<HTMLButtonElement>("button.table-btn");
  if (btn) {
    btn.classList.remove("status-held");
    btn.dataset.status = "taken";
    btn.classList.add("status-taken");
    const state = btn.querySelector(".state");
    if (state) state.textContent = "Taken";
  }
}

// ===== Your table =====

/** The region mounts with the first live hold and stays mounted afterwards. */
let yourTableMounted = false;

function renderYourTable(): void {
  const region = els.yourTable;
  if (!hold && heldTableId === null) {
    if (!yourTableMounted) {
      region.hidden = true;
      region.innerHTML = "";
    }
    return;
  }
  region.hidden = false;
  yourTableMounted = true;
  const depositCents = hold?.deposit_cents ?? 0;
  const amount = euro(depositCents);
  const depositParagraph = depositCents > 0
    ? `<p class="mini-state">A deposit of €${amount} is charged now: €15 for each guest. It is refunded in full if you cancel at least 24 hours before your table. After that it is kept.</p>`
    : "";
  const depositCheckbox = depositCents > 0
    ? `<label class="field"><input type="checkbox" id="accept-deposit"> <span>I accept the €${amount} deposit and the refund rule above</span></label>`
    : "";
  const depositKey = depositCents > 0 ? "pay" : "book";
  region.innerHTML = `
    <div class="countdown" id="countdown-row"></div>
    <p class="mini-state" id="hold-ended" hidden>Your hold on table ${heldTableId ?? ""} has ended.</p>
    <button type="button" class="btn btn-quiet" id="release-btn">Release table</button>
    <form id="confirm-form" novalidate>
      <label class="field"><span>Name</span><input type="text" id="name" autocomplete="name" maxlength="80"></label>
      <label class="field"><span>Email</span><input type="email" id="email" autocomplete="email" maxlength="254"></label>
      <label class="field"><span>Phone (optional)</span><input type="tel" id="phone" maxlength="32"></label>
      ${depositParagraph}
      ${depositCheckbox}
      <p><button type="submit" class="btn" id="confirm-btn" data-key="${depositKey}">
        ${depositCents > 0 ? `Pay €${amount} and book` : "Book table"}</button></p>
    </form>`;

  const releaseBtn = region.querySelector<HTMLButtonElement>("#release-btn");
  releaseBtn?.addEventListener("click", async () => { await releaseHold(true); });

  const form = region.querySelector<HTMLFormElement>("#confirm-form");
  form?.addEventListener("submit", (e) => { e.preventDefault(); void confirmHold(); });

  startCountdown();
}

function startCountdown(): void {
  const row = document.getElementById("countdown-row");
  if (!row || !hold) return;
  const total = rules?.hold_seconds ?? 300;
  const label = document.createElement("span");
  label.className = "label";
  const bar = document.createElement("progress");
  bar.id = "hold-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Hold time remaining");
  bar.max = total;
  row.replaceChildren(bar, label);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const paint = (): void => {
    const remainingMs = Math.max(0, new Date(hold?.expires_at ?? 0).getTime() - clock.now().getTime());
    const seconds = Math.floor(remainingMs / 1000);
    bar.value = reduced ? Math.ceil(seconds / 15) * 15 : seconds;
    label.textContent = `Held for ${formatCountdown(seconds)}`;
    if (seconds <= 0 && holdTableLive() === false && hold && !holdEndedHandled) {
      void holdEndedLocally();
    }
  };
  paint();
  stopCountdown();
  holdCountdownTimer = window.setInterval(paint, 1000);
  // Reduced motion: the ring segment updates every 15 seconds; the text every second.
  if (reduced) {
    window.setInterval(() => { const cell = heldTableId ? els.plan.querySelector(`.table-cell[data-table="${heldTableId}"] .holdring`) : null; void cell; }, 15_000);
  }
}

/** A guard so the two expiry paths (countdown and live event) act once. */
let holdEndedHandled = false;

async function holdEndedLocally(): Promise<void> {
  if (!hold) return;
  const endedTable = heldTableId;
  hold = null;
  stopCountdown();
  holdEndedHandled = true;
  if (endedTable) {
    liftOff(endedTable);
  }
  heldTableId = null;
  renderYourTable();
  const notice = document.getElementById("hold-ended");
  if (notice && endedTable) {
    notice.hidden = false;
    notice.textContent = `Your hold on table ${endedTable} has ended.`;
  }
  announce(endedTable ? `Your hold on table ${endedTable} has ended.` : "Your hold has ended.");
  const confirmBtn = document.getElementById("confirm-btn") as HTMLButtonElement | null;
  if (confirmBtn) confirmBtn.disabled = true;
  await renderPlan();
}

async function confirmHold(): Promise<void> {
  if (!hold) return;
  const nameEl = document.getElementById("name") as HTMLInputElement | null;
  const emailEl = document.getElementById("email") as HTMLInputElement | null;
  const phoneEl = document.getElementById("phone") as HTMLInputElement | null;
  const acceptEl = document.getElementById("accept-deposit") as HTMLInputElement | null;
  const confirmBtn = document.getElementById("confirm-btn") as HTMLButtonElement | null;
  if (!nameEl || !emailEl || !confirmBtn) return;

  const name = nameEl.value.trim();
  const email = emailEl.value.trim();
  const phone = phoneEl?.value ?? "";
  const acceptDeposit = acceptEl?.checked === true;

  // Field errors are shown under the field and announced; typed details stay.
  const errors: Record<string, string> = {};
  if (name.length < 1 || name.length > 80) errors.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = "Enter an email address like name@example.com.";
  if (phone.length > 32) errors.phone = "Use 32 characters or fewer.";
  if (hold.deposit_cents > 0 && !acceptDeposit) errors.accept_deposit = "Tick the box to accept the deposit.";

  const existing = Array.from(document.querySelectorAll(".field-error"));
  for (const el of existing) el.remove();
  if (Object.keys(errors).length > 0) {
    const addError = (key: string, id: string): void => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      const wrap = input?.closest(".field");
      if (input && wrap) {
        const p = document.createElement("p");
        p.className = "field-error";
        p.id = `err-${id}`;
        p.textContent = errors[key];
        wrap.appendChild(p);
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", `err-${id}`);
      }
    };
    if (errors.name) addError("name", "name");
    if (errors.email) addError("email", "email");
    if (errors.phone) addError("phone", "phone");
    if (errors.accept_deposit && acceptEl) {
      const wrap = acceptEl.closest(".field");
      if (wrap) {
        const p = document.createElement("p");
        p.className = "field-error";
        p.textContent = errors.accept_deposit;
        wrap.appendChild(p);
      }
    }
    announce(Object.values(errors)[0]);
    return;
  }

  confirmBtn.disabled = true;
  const originalLabel = confirmBtn.textContent;
  confirmBtn.textContent = "Booking...";

  try {
    const resp = await apiJson<ConfirmResponse>(`/api/holds/${hold.hold_id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey() },
      body: JSON.stringify({ name, email, ...(phone ? { phone } : {}), accept_deposit: acceptDeposit }),
    });
    stopCountdown();
    const url = new URL(resp.manage_url);
    // Navigate to exactly /manage/<token> with no query string.
    location.href = url.pathname;
  } catch (e) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = originalLabel;
    if (e instanceof ApiFailure) {
      if (e.status === 503) {
        renderBannerNow();
        if (e.code === "holds_paused") announce("Table holds are paused. Please try again in a few minutes.");
        else announce("Deposits are paused. Bookings that need a deposit can't be confirmed right now.");
        return;
      }
      if (e.code === "payment_failed") {
        announce("Your deposit didn't go through, so nothing was booked. Your table is still held.");
        return;
      }
      if (e.status === 410) {
        await holdEndedLocally();
        return;
      }
      if (e.status === 409) {
        if (e.code === "table_taken") {
          await holdEndedLocally();
          return;
        }
        announce("That hold has already been used.");
        return;
      }
      if (e.status === 422) {
        const fields = e.fields;
        const first = Object.values(fields)[0];
        if (first) announce(first);
        return;
      }
    }
    announce("We couldn't book that table. Please try again.");
  }
}

function announce(text: string): void {
  els.statusRegion.textContent = text;
}

// ===== Live events =====

function wireEvents(): void {
  openEvents(`/api/floor/events?date=${encodeURIComponent(choice.date)}`, (data) => {
    const type = String(data.type ?? "");
    if (type === "hold.expired") {
      const tables = (data.table_ids ?? []) as string[];
      if (hold && tables.includes(heldTableId ?? "")) {
        void holdEndedLocally();
      }
      void renderPlan();
    } else if (["hold.created", "hold.released", "booking.created", "booking.cancelled",
      "booking.seated", "booking.completed", "booking.no_show", "walkin.seated",
      "offer.created", "offer.claimed", "offer.lapsed"].includes(type)) {
      void renderPlan();
    }
  });
}

// ===== Main =====

async function main(): Promise<void> {
  [rules, floor] = await Promise.all([
    apiJson<RulesResponse>("/api/rules"),
    apiJson<FloorResponse>("/api/floor"),
  ]);
  const today = lisbonToday();
  els.dateInput.min = today;
  const max = new Date(`${today}T12:00:00Z`);
  max.setUTCDate(max.getUTCDate() + (rules.booking_horizon_days));
  els.dateInput.max = max.toISOString().slice(0, 10);

  normaliseInputs();
  els.dateInput.value = choice.date;
  renderPartyRow();
  summaryLine();
  updateWaitlistLink();

  els.dateInput.addEventListener("change", () => {
    const v = els.dateInput.value;
    if (v) void changeChoice({ date: v }, els.dateInput);
  });

  window.addEventListener("popstate", () => {
    const p = new URLSearchParams(location.search);
    const party = Number(p.get("party"));
    const date = p.get("date") ?? "";
    const time = p.get("time");
    if (Number.isInteger(party) && party >= 1 && party <= 8) choice.party = party;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) choice.date = date;
    choice.time = time ?? null;
    renderPartyRow();
    els.dateInput.value = choice.date;
    summaryLine();
    void reloadForChoice(null);
  });

  watchStatus((s) => renderBanners(els.bannerSlot, s, false));
  wireEvents();

  // When the page unloads, send a release for the live hold in a way that survives unload.
  window.addEventListener("pagehide", () => {
    if (hold && holdTableLive()) {
      void fetch(`/api/holds/${hold.hold_id}`, {
        method: "DELETE",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => undefined);
    }
  });

  await reloadForChoice(null);
}

void main();
