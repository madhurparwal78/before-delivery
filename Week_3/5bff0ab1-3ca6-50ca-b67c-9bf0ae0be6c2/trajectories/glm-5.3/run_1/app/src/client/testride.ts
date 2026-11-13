// The test-ride booking screen: the slot grid with a roving tabindex, the licence
// fields that start empty on every load, and booking, moving and cancelling.
import {
  LiveClient,
  api,
  apiJson,
  istHm,
  maybe,
  pollIdentity,
  readMe,
  replaceUrl,
  status,
  type Me,
  type RideJson,
} from "./core";
import { openSignIn } from "./auth";

interface SlotRow {
  startsAt: string;
  label: string;
  state: string;
}

interface SlotsReply {
  date: string;
  dayLabel: string;
  open: boolean;
  slots: SlotRow[];
}

interface RideDaysReply {
  days: { date: string; dayLabel: string }[];
}

class TestRidePage {
  hub = "pune";
  model = "megh-349";
  date = "";
  slot = "";
  chosenCell: string | null = null;
  slots: SlotRow[] = [];
  open = true;
  me: Me = { user: null, signedIn: false };
  activeRide: RideJson | null = null;
  liveClient!: LiveClient;

  init(): void {
    this.readUrl();
    this.bindControls();
    void this.loadRideDays();
    this.liveClient = new LiveClient(`?hub=${this.hub}&model=${this.model}&finish=monsoon-slate`, {
      onMine: () => void this.reRead(),
      onSession: (state) => {
        if (state === "ended") this.onSessionEnded();
      },
    });
    pollIdentity((me) => {
      this.me = me;
      void this.reRead();
    });
    void this.reRead();
  }

  private readUrl(): void {
    const url = new URL(location.href);
    const hub = url.searchParams.get("hub");
    this.hub = ["pune", "bengaluru", "gurugram", "kochi"].includes(hub ?? "") ? (hub as string) : "pune";
    const model = url.searchParams.get("model");
    this.model = model === "desh-648" ? "desh-648" : "megh-349";
    const date = url.searchParams.get("date");
    this.date = date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
    const slot = url.searchParams.get("slot");
    this.slot = slot !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot) ? slot : "";
    this.syncControls();
  }

  private writeUrl(): void {
    const params = new URLSearchParams();
    params.set("hub", this.hub);
    params.set("model", this.model);
    if (this.date) params.set("date", this.date);
    if (this.slot) params.set("slot", this.slot);
    replaceUrl(`${location.pathname}?${params.toString()}`);
  }

  private syncControls(): void {
    const hubSelect = maybe<HTMLSelectElement>("#hub-select");
    if (hubSelect) hubSelect.value = this.hub;
    document.querySelectorAll<HTMLInputElement>('input[name="model"]').forEach((el) => {
      el.checked = el.value === this.model;
    });
  }

  private bindControls(): void {
    maybe<HTMLSelectElement>("#hub-select")?.addEventListener("change", (e) => {
      this.hub = (e.target as HTMLSelectElement).value;
      this.onSelectionChange();
    });
    document.querySelectorAll<HTMLInputElement>('input[name="model"]').forEach((el) => {
      el.addEventListener("change", () => {
        if (el.checked) {
          this.model = el.value;
          this.onSelectionChange();
        }
      });
    });
    maybe<HTMLSelectElement>("#ride-day")?.addEventListener("change", (e) => {
      this.date = (e.target as HTMLSelectElement).value;
      this.slot = "";
      this.chosenCell = null;
      void this.loadSlots();
      this.writeUrl();
    });

    // the grid: one tab stop, roving tabindex, arrows move by the visible column count
    const grid = maybe<HTMLElement>("#slot-grid");
    grid?.addEventListener("keydown", (ev) => {
      const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
      if (cells.length === 0) return;
      const idx = cells.findIndex((c) => c.tabIndex === 0);
      const cols = window.innerWidth >= 768 ? 4 : 2;
      const move = (next: number) => {
        if (next < 0 || next >= cells.length) return;
        ev.preventDefault();
        cells.forEach((c, i) => (c.tabIndex = i === next ? 0 : -1));
        cells[next].focus();
      };
      if (ev.key === "ArrowRight") move(idx + 1);
      else if (ev.key === "ArrowLeft") move(idx - 1);
      else if (ev.key === "ArrowDown") move(idx + cols);
      else if (ev.key === "ArrowUp") move(idx - cols);
      else if (ev.key === "Home") move(0);
      else if (ev.key === "End") move(cells.length - 1);
      else if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        this.chooseCell(cells[idx >= 0 ? idx : 0]);
      }
    });
    grid?.addEventListener("click", (ev) => {
      const cell = (ev.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
      if (cell) this.chooseCell(cell);
    });

    maybe<HTMLButtonElement>("#try-next-day")?.addEventListener("click", () => {
      void this.nextDay();
    });
    maybe<HTMLButtonElement>("#book-ride")?.addEventListener("click", () => void this.book());
    maybe<HTMLButtonElement>("#move-ride")?.addEventListener("click", () => void this.move());
    maybe<HTMLButtonElement>("#cancel-ride")?.addEventListener("click", () => void this.cancel());
  }

  private onSelectionChange(): void {
    this.syncControls();
    this.liveClient.setQuery(`?hub=${this.hub}&model=${this.model}&finish=monsoon-slate`);
    void this.loadRideDays();
    this.writeUrl();
  }

  private async loadRideDays(): Promise<void> {
    const res = await api<RideDaysReply>(`/api/hubs/${this.hub}/ride-days`);
    if (!res.ok) return;
    const select = maybe<HTMLSelectElement>("#ride-day");
    if (!select) return;
    // keep the same nodes: update in place
    while (select.options.length < res.data.days.length) {
      select.add(new Option("", ""));
    }
    res.data.days.forEach((d, i) => {
      const opt = select.options[i];
      opt.value = d.date;
      opt.textContent = d.dayLabel;
    });
    while (select.options.length > res.data.days.length) {
      select.remove(select.options.length - 1);
    }
    // a chosen day that rolls off at 00:00 IST moves to the first offered day
    const stillOffered = res.data.days.some((d) => d.date === this.date);
    if (!this.date || !stillOffered) {
      const previous = this.date;
      this.date = res.data.days[0]?.date ?? "";
      select.value = this.date;
      if (previous && this.slot) {
        status.announce("That slot has just closed. Pick another.");
        this.slot = "";
      }
      this.writeUrl();
    } else {
      select.value = this.date;
    }
    await this.loadSlots();
  }

  private async loadSlots(): Promise<void> {
    if (!this.date) return;
    const res = await api<SlotsReply>(`/api/hubs/${this.hub}/slots?date=${this.date}`);
    if (!res.ok) return;
    // newest input wins: only render when the reply matches the current choice
    if (res.data.date !== this.date) return;
    this.slots = res.data.slots;
    this.open = res.data.open;
    this.renderGrid();
    this.renderActions();
    this.writeUrl();
  }

  private renderGrid(): void {
    const grid = maybe<HTMLElement>("#slot-grid");
    if (!grid) return;
    const empty = maybe<HTMLElement>("#day-empty");
    const cellsData = this.slots;
    if (empty) {
      const noneFree = cellsData.length > 0 && cellsData.every((s) => s.state !== "free");
      empty.hidden = cellsData.length > 0 && !noneFree;
      if (cellsData.length === 0 && this.open === false) {
        empty.hidden = false;
      }
    }
    // update the same DOM nodes in place
    const existing = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    while (existing.length < cellsData.length) {
      const cell = document.createElement("div");
      cell.setAttribute("role", "gridcell");
      cell.tabIndex = -1;
      cell.innerHTML = `<span class="cell-label"></span><span class="cell-state"></span>`;
      grid.appendChild(cell);
      existing.push(cell);
    }
    while (existing.length > cellsData.length) {
      existing.pop()?.remove();
    }
    cellsData.forEach((slot, i) => {
      const cell = existing[i];
      cell.dataset.start = slot.startsAt;
      cell.setAttribute("aria-label", slot.label);
      cell.setAttribute("aria-disabled", slot.state === "free" ? "false" : "true");
      const isChosen = this.slot === istHm(slot.startsAt);
      cell.setAttribute("aria-selected", isChosen ? "true" : "false");
      // one tab stop: the chosen cell, or the first enabled cell
      cell.tabIndex = isChosen || (!this.slot && i === 0) ? 0 : -1;
      (cell.querySelector(".cell-label") as HTMLElement).textContent = slot.label;
      (cell.querySelector(".cell-state") as HTMLElement).textContent =
        slot.state === "taken" ? "Taken" : slot.state === "past_cut_off" ? "Closed" : "";
      cell.classList.toggle("taken", slot.state !== "free");
    });
    // a chosen cell no longer available clears, with the matching status announced
    if (this.slot) {
      const match = cellsData.find((s) => istHm(s.startsAt) === this.slot);
      if (!match) {
        this.slot = "";
        this.writeUrl();
      } else if (match.state === "taken") {
        status.announce("That slot has just been taken. Pick another.");
        this.slot = "";
        this.writeUrl();
      } else if (match.state === "past_cut_off") {
        status.announce("That slot has just closed. Pick another.");
        this.slot = "";
        this.writeUrl();
      }
    }
  }

  private chooseCell(cell: HTMLElement): void {
    if (cell.getAttribute("aria-disabled") === "true") return;
    const start = cell.dataset.start ?? "";
    const hhmm = istHm(start);
    this.slot = hhmm;
    this.chosenCell = hhmm;
    this.writeUrl();
    const grid = maybe<HTMLElement>("#slot-grid");
    grid?.querySelectorAll<HTMLElement>('[role="gridcell"]').forEach((c) => {
      c.setAttribute("aria-selected", c === cell ? "true" : "false");
      c.tabIndex = c === cell ? 0 : -1;
    });
    this.renderActions();
  }

  private renderActions(): void {
    const book = maybe<HTMLButtonElement>("#book-ride");
    const move = maybe<HTMLButtonElement>("#move-ride");
    const cancel = maybe<HTMLButtonElement>("#cancel-ride");
    if (book) book.hidden = this.activeRide !== null;
    if (move) move.hidden = this.activeRide === null;
    if (cancel) cancel.hidden = this.activeRide === null;
    if (move && this.activeRide !== null) {
      move.setAttribute("aria-disabled", this.slot ? "false" : "true");
    }
  }

  private async nextDay(): Promise<void> {
    const select = maybe<HTMLSelectElement>("#ride-day");
    if (!select) return;
    const idx = Array.from(select.options).findIndex((o) => o.value === this.date);
    const next = select.options[Math.min(idx + 1, select.options.length - 1)];
    if (next) {
      this.date = next.value;
      this.slot = "";
      select.value = this.date;
      await this.loadSlots();
      this.writeUrl();
    }
  }

  private licenceValues(): { licenceNumber: string; licenceValidUntil: string; hasMcwg: boolean } {
    const num = (maybe<HTMLInputElement>("#licence-number")?.value ?? "").trim();
    const date = (maybe<HTMLInputElement>("#licence-date")?.value ?? "").trim();
    const mcwg = (maybe<HTMLInputElement>("#mcwg") as HTMLInputElement | null)?.checked ?? false;
    return { licenceNumber: num, licenceValidUntil: date, hasMcwg: mcwg };
  }

  private async ensureSignedIn(): Promise<boolean> {
    if (this.me.signedIn) return true;
    const ok = await openSignIn(maybe<HTMLButtonElement>("#book-ride"));
    if (ok) {
      this.me = await readMe();
    }
    return ok;
  }

  private fieldError(msg: string): void {
    const el = maybe<HTMLElement>("#licence-error");
    if (el) {
      el.textContent = msg;
      el.hidden = false;
    }
  }

  private async book(): Promise<void> {
    if (!this.slot) return;
    if (!(await this.ensureSignedIn())) return;
    const lic = this.licenceValues();
    status.announce("Booking this ride…");
    const res = await apiJson<{ ride: RideJson }>("/api/rides", "POST", {
      hub: this.hub,
      model: this.model,
      startsAt: this.slotStartIso(),
      licenceNumber: lic.licenceNumber,
      licenceValidUntil: lic.licenceValidUntil,
      hasMcwg: lic.hasMcwg,
    });
    if (!res.ok) {
      this.handleRideError(res.fail.status, res.fail.code, res.fail.message);
      return;
    }
    status.announce(`Ride booked for ${res.data.ride.dayLabel}, ${res.data.ride.label.replace(" IST", "")} IST.`);
    void this.reRead();
    await this.loadSlots();
  }

  private handleRideError(httpStatus: number, code: string, message: string): void {
    if (httpStatus === 401) {
      this.onSessionEnded();
      return;
    }
    switch (code) {
      case "slot_taken":
        status.announce("That slot has just been taken. Pick another.");
        break;
      case "ride_cut_off":
        status.announce("That slot has just closed. Pick another.");
        break;
      case "ride_exists":
        status.announce("You already have a ride booked on this model.");
        break;
      case "invalid_slot":
        status.announce("That slot is not valid.");
        break;
      case "licence_invalid":
        this.fieldError("Enter a licence number like MH1220190043210.");
        break;
      case "mcwg_required":
        this.fieldError("A test ride needs a licence that covers motorcycles with gear.");
        break;
      case "licence_expired":
        this.fieldError("Your licence must be valid on the ride day.");
        break;
      case "invalid_body":
        this.fieldError(message || "That request is not valid.");
        break;
      case "hub_unreachable":
        status.announce("Hub system unreachable. Your ride is unchanged. Try again.");
        break;
      default:
        status.announce(message || "Something went wrong. Try again.");
    }
    void this.loadSlots();
  }

  private slotStartIso(): string {
    const match = this.slots.find((s) => istHm(s.startsAt) === this.slot);
    return match ? match.startsAt : `${this.date}T${this.slot}:00+05:30`;
  }

  private async move(): Promise<void> {
    if (!this.activeRide || !this.slot) return;
    status.announce("Booking this ride…");
    const res = await apiJson<{ ride: RideJson }>(`/api/rides/${this.activeRide.id}/move`, "POST", {
      startsAt: this.slotStartIso(),
    });
    if (!res.ok) {
      this.handleRideError(res.fail.status, res.fail.code, res.fail.message);
      return;
    }
    status.announce(`Ride booked for ${res.data.ride.dayLabel}, ${res.data.ride.label.replace(" IST", "")} IST.`);
    void this.reRead();
    await this.loadSlots();
  }

  private async cancel(): Promise<void> {
    if (!this.activeRide) return;
    const res = await apiJson<{ ride: RideJson }>(`/api/rides/${this.activeRide.id}/cancel`, "POST");
    if (!res.ok) {
      this.handleRideError(res.fail.status, res.fail.code, res.fail.message);
      return;
    }
    status.announce("Ride cancelled.");
    void this.reRead();
    await this.loadSlots();
  }

  private onSessionEnded(): void {
    status.announce("Your session has ended. Sign in to continue. Your choices are kept.", "session");
    this.me = { user: null, signedIn: false };
  }

  private async reRead(): Promise<void> {
    const me = await readMe();
    this.me = me;
    if (!me.signedIn) return;
    const res = await api<{ rides: RideJson[] }>("/api/rides");
    if (!res.ok) {
      if (res.fail.status === 401) this.onSessionEnded();
      return;
    }
    const booked = res.data.rides.find((r) => r.state === "booked" && r.model === this.model);
    this.activeRide = booked ?? null;
    this.renderActions();
  }
}

function boot(): void {
  if (!maybe("#slot-grid")) return;
  new TestRidePage().init();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

