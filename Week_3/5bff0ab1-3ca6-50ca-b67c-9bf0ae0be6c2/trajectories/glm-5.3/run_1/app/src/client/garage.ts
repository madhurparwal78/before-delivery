// The Garage: the rider's holdings as three stacked bands - lock, ride, delivery -
// with the price sheet, reminders, the delivery-day grid and the wait line.
import {
  api,
  apiJson,
  formatPaise,
  maybe,
  pollIdentity,
  qs,
  readMe,
  status,
  type LockJson,
  type Me,
  type RideJson,
} from "./core";
import { openSignIn } from "./auth";

interface DeliveryDaysReply {
  days: { date: string; dayLabel: string; capacity: number; placesLeft: number; state: string }[];
}

class GaragePage {
  me: Me = { user: null, signedIn: false };
  locks: LockJson[] = [];
  ride: RideJson | null = null;
  days: DeliveryDaysReply["days"] = [];
  chosenDate: string | null = null;

  init(): void {
    pollIdentity(async (me) => {
      const changed = me.user?.id !== this.me.user?.id || me.signedIn !== this.me.signedIn;
      this.me = me;
      if (!me.signedIn) {
        this.renderSignedOut();
        if (location.pathname === "/garage") {
          void openSignIn(null).then((ok) => {
            if (ok) void this.reRead();
          });
        }
        return;
      }
      if (changed && me.user !== null) {
        void this.reRead();
      }
    });
    this.bindControls();
    void this.reRead();
  }

  private bindControls(): void {
    // the bands persist; their contents change, so all events are delegated
    const lockBand = maybe<HTMLElement>("#lock-band");
    lockBand?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!btn) return;
      if (btn.id === "release-lock") void this.releaseLock(btn.dataset.lock ?? "");
      else if (btn.id === "make-sheet") void this.makeSheet(btn.dataset.lock ?? "");
      else if (btn.id === "reminders") void this.turnOnReminders();
    });
    const deliveryBand = maybe<HTMLElement>("#delivery-band");
    deliveryBand?.addEventListener("click", (ev) => {
      const cell = (ev.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
      if (cell) {
        this.chooseDay(cell);
        return;
      }
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!btn) return;
      if (btn.id === "set-delivery") void this.setDeliveryDay();
      else if (btn.id === "wait-place") void this.joinLine();
      else if (btn.id === "leave-line") void this.leaveLine();
    });
    deliveryBand?.addEventListener("keydown", (ev) => {
      const grid = maybe<HTMLElement>("#delivery-grid", deliveryBand);
      if (!grid) return;
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
      else if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        this.chooseDay(cells[idx >= 0 ? idx : 0]);
      }
    });
  }

  private activeLocks(): LockJson[] {
    return this.locks.filter((l) => ["requested", "locked", "delivery_set"].includes(l.state));
  }

  private async reRead(): Promise<void> {
    const me = await readMe();
    this.me = me;
    if (!me.signedIn) {
      this.renderSignedOut();
      return;
    }
    const [locksRes, ridesRes] = await Promise.all([
      api<{ locks: LockJson[] }>("/api/locks"),
      api<{ rides: RideJson[] }>("/api/rides"),
    ]);
    if (!locksRes.ok || !ridesRes.ok) {
      if (!locksRes.ok && locksRes.fail.status === 401) this.onSessionEnded();
      return;
    }
    this.locks = locksRes.data.locks;
    const onThisModel = ridesRes.data.rides.filter((r) => r.state === "booked");
    this.ride = onThisModel[0] ?? ridesRes.data.rides.find((r) => r.state === "ridden" || r.state === "no_show") ?? null;
    const active = this.activeLocks();
    if (active.length > 0) {
      const daysRes = await api<DeliveryDaysReply>(`/api/locks/${active[0].id}/delivery-days`);
      if (daysRes.ok) this.days = daysRes.data.days;
    } else {
      this.days = [];
    }
    this.render();
  }

  // ---------- rendering: update the existing elements, never replace the nodes ----------

  private render(): void {
    this.renderLockBand();
    this.renderRideBand();
    this.renderDeliveryBand();
  }

  private renderSignedOut(): void {
    const band = maybe<HTMLElement>("#lock-band");
    if (band) band.innerHTML = "";
    const ride = maybe<HTMLElement>("#ride-band");
    if (ride) ride.innerHTML = "";
    const delivery = maybe<HTMLElement>("#delivery-band");
    if (delivery) delivery.innerHTML = "";
  }

  private renderLockBand(): void {
    const band = maybe<HTMLElement>("#lock-band");
    const statement = maybe<HTMLElement>("#garage-statement");
    if (!band) return;
    const active = this.activeLocks();
    // The statement uses the earliest expiry among locked locks, or the earliest
    // delivery date among delivery_set locks.
    if (statement) {
      const locked = active.filter((l) => l.state === "locked" && l.expiresAt !== null);
      const deliverySet = active.filter((l) => l.state === "delivery_set" && l.deliveryDate !== null);
      if (locked.length > 0) {
        const earliest = locked.reduce((a, b) => (a.expiresAt! < b.expiresAt! ? a : b));
        const weekday = new Date(earliest.expiresAt!).toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });
        const hour = hourLabel(earliest.expiresAt!);
        statement.textContent = `Yours until ${weekday}, ${hour} IST.`;
      } else if (deliverySet.length > 0) {
        const earliest = deliverySet.reduce((a, b) => (a.deliveryDate! < b.deliveryDate! ? a : b));
        statement.textContent = `Yours to collect on ${dddDMon(earliest.deliveryDate!)}.`;
      }
    }
    if (active.length === 0) {
      band.innerHTML = `<p class="statement">Nothing is held for you yet.</p><a class="action-link" href="/showroom">Start the build</a>`;
      return;
    }
    // one block per active lock, newest first
    band.innerHTML = "";
    for (const lock of [...active].reverse()) {
      const block = document.createElement("div");
      block.className = "lock-block";
      block.dataset.lockId = lock.id;
      const isRequested = lock.state === "requested";
      if (isRequested) {
        block.innerHTML = `
          <p class="pending">Checking with the hub.</p>`;
      } else {
        block.innerHTML = `
          <div class="amounts">
            <div class="amount"><span class="numeral">${formatPaise(lock.exShowroomPaise)}</span><span class="numeral-sentence">Ex-showroom, fixed at your lock.</span></div>
            <div class="amount"><span class="numeral">${formatPaise(lock.onRoadPaise)}</span><span class="numeral-sentence">On the road, fixed at your lock.</span></div>
          </div>
          <p class="hours" id="hours-${lock.id}">${lock.expiresAt !== null ? `${lock.hoursLeft} hours left` : ""}</p>
          <div class="actions">
            ${lock.state === "locked" ? `<button class="secondary" id="release-lock" data-lock="${lock.id}">Release this lock</button>` : ""}
            ${lock.state === "locked" || lock.state === "delivery_set" ? `<button class="secondary" id="make-sheet" data-lock="${lock.id}">Make price sheet</button>` : ""}
            ${lock.sheetReady ? `<a class="action-link" id="download-sheet" href="/api/locks/${lock.id}/sheet" download>Download price sheet</a>` : ""}
            ${!this.remindersOn() ? `<button class="secondary" id="reminders" data-lock="${lock.id}">Turn on reminders</button>` : `<span class="reminders-on">Reminders on.</span>`}
          </div>
          <div class="outage-field" id="sheet-error-${lock.id}" hidden></div>
          <div class="outage-field" id="reminder-error-${lock.id}" hidden></div>`;
      }
      band.appendChild(block);
    }
  }

  private remindersOn(): boolean {
    return this.me.user?.remindersOn ?? false;
  }

  private renderRideBand(): void {
    const band = maybe<HTMLElement>("#ride-band");
    if (!band) return;
    if (this.ride === null) {
      band.innerHTML = `<p class="statement">No ride booked.</p><a class="action-link" href="/test-ride">Pick a slot</a>`;
      return;
    }
    const r = this.ride;
    if (r.state === "booked") {
      band.innerHTML = `
        <h2>Booked</h2>
        <p>${r.dayLabel}, ${r.label}</p>
        <a class="action-link" href="/test-ride?hub=${r.hub}&model=${r.model}">Change this ride</a>`;
    } else {
      const word = r.state === "ridden" ? "Ridden" : "No-show";
      band.innerHTML = `<h2>${word}</h2><p>${r.dayLabel}, ${r.label}</p>`;
    }
  }

  private renderDeliveryBand(): void {
    const band = maybe<HTMLElement>("#delivery-band");
    if (!band) return;
    const active = this.activeLocks();
    if (active.length === 0) {
      band.innerHTML = `<p class="statement">Lock a price to choose a day.</p><a class="action-link" href="/showroom">Start the build</a>`;
      return;
    }
    const lock = active[0];
    band.innerHTML = "";
    const block = document.createElement("div");
    block.className = "delivery-block";
    if (lock.state === "delivery_set" && lock.deliveryDate !== null) {
      block.innerHTML = `<h2>Delivery set</h2><p>${dddDMon(lock.deliveryDate)}</p>`;
    } else {
      const chosen = this.chosenDate;
      const waiting = lock.waitingFor !== null && lock.waitPosition !== null;
      const grid = document.createElement("div");
      grid.className = "grid";
      grid.setAttribute("role", "grid");
      grid.setAttribute("aria-label", "Delivery days");
      grid.id = "delivery-grid";
      const cells = this.days.map((d) => {
        const label =
          d.state === "closed"
            ? `${dddDMon(d.date)}, closed`
            : d.placesLeft === 0
              ? `${dddDMon(d.date)}, full`
              : d.placesLeft === 1
                ? `${dddDMon(d.date)}, 1 place left`
                : `${dddDMon(d.date)}, ${d.placesLeft} places left`;
        return `<div class="grid-cell" role="gridcell" tabindex="-1" data-date="${d.date}" aria-label="${label}" aria-disabled="${d.state === "closed" ? "true" : "false"}" aria-selected="${chosen === d.date ? "true" : "false"}"><span class="cell-label">${label}</span></div>`;
      });
      grid.innerHTML = cells.join("");
      block.appendChild(grid);
      const actions = document.createElement("div");
      actions.className = "actions";
      const chosenDay = this.days.find((d) => d.date === chosen);
      const canSet = chosenDay !== undefined && chosenDay.state === "open";
      actions.innerHTML = `
        <button class="primary" id="set-delivery" aria-disabled="${canSet ? "false" : "true"}">Set delivery day</button>
        ${chosenDay !== undefined && chosenDay.state === "full" && lock.waitingFor !== chosenDay.date ? `<button class="secondary" id="wait-place">Wait for a place</button>` : ""}
        ${waiting ? `<button class="secondary" id="leave-line">Leave the line</button>` : ""}
      `;
      block.appendChild(actions);
      if (waiting) {
        const line = document.createElement("p");
        line.className = "wait-line";
        line.textContent = `Number ${lock.waitPosition} in line for ${dddDMon(lock.waitingFor!)}.`;
        block.appendChild(line);
      }
    }
    band.appendChild(block);
  }

  private chooseDay(cell: HTMLElement): void {
    if (cell.getAttribute("aria-disabled") === "true") return;
    const date = cell.dataset.date ?? "";
    this.chosenDate = date;
    this.renderDeliveryBand();
    const grid = maybe<HTMLElement>("#delivery-grid");
    const target = grid?.querySelector<HTMLElement>(`[data-date="${date}"]`);
    target?.focus();
  }

  // ---------- actions ----------

  private async ensureSignedIn(): Promise<boolean> {
    if (this.me.signedIn) return true;
    const ok = await openSignIn(null);
    if (ok) this.me = await readMe();
    return ok;
  }

  private async releaseLock(lockId?: string): Promise<void> {
    if (!(await this.ensureSignedIn())) return;
    const id = lockId ?? this.activeLocks()[0]?.id;
    if (!id) return;
    const res = await apiJson<{ lock: LockJson }>(`/api/locks/${id}/release`, "POST");
    if (!res.ok) {
      if (res.fail.status === 503) status.announce("Hub system unreachable. Your lock is still held. Try again.");
      else if (res.fail.status === 401) this.onSessionEnded();
      return;
    }
    status.announce("Lock released.");
    void this.reRead();
  }

  private async makeSheet(lockId?: string): Promise<void> {
    if (!(await this.ensureSignedIn())) return;
    const id = lockId ?? this.activeLocks()[0]?.id;
    if (!id) return;
    status.announce("Making price sheet…");
    const res = await apiJson<{ lock: LockJson }>(`/api/locks/${id}/sheet`, "POST");
    if (!res.ok) {
      if (res.fail.status === 503) {
        status.announce("Price sheet could not be made. Try again.");
        const field = maybe<HTMLElement>(`#sheet-error-${id}`);
        if (field) {
          field.textContent = "Price sheet could not be made. Try again.";
          field.hidden = false;
        }
      } else if (res.fail.status === 401) this.onSessionEnded();
      return;
    }
    status.announce("Price sheet ready.");
    void this.reRead();
  }

  private async turnOnReminders(): Promise<void> {
    if (!(await this.ensureSignedIn())) return;
    status.announce("Turning on reminders…");
    const res = await apiJson<{ remindersOn: boolean; topic: string }>("/api/reminders", "POST");
    if (!res.ok || !res.data.remindersOn) {
      status.announce("Reminders could not be turned on. Try again.");
      const id = this.activeLocks()[0]?.id;
      if (id) {
        const field = maybe<HTMLElement>(`#reminder-error-${id}`);
        if (field) {
          field.textContent = "Reminders could not be turned on. Try again.";
          field.hidden = false;
        }
      }
      return;
    }
    status.announce("Reminders on.");
    this.me.user = this.me.user ? { ...this.me.user, remindersOn: true } : this.me.user;
    void this.reRead();
  }

  private async setDeliveryDay(): Promise<void> {
    if (!(await this.ensureSignedIn())) return;
    const lock = this.activeLocks()[0];
    if (!lock || !this.chosenDate) return;
    const chosenDay = this.days.find((d) => d.date === this.chosenDate);
    if (!chosenDay || chosenDay.state !== "open") return;
    status.announce("Setting delivery day…");
    const res = await apiJson<{ lock: LockJson }>(`/api/locks/${lock.id}/delivery`, "POST", { date: this.chosenDate });
    if (!res.ok) {
      this.handleDeliveryError(res.fail.status, res.fail.code);
      return;
    }
    status.announce(`Delivery set for ${dddDMon(this.chosenDate)}.`);
    void this.reRead();
  }

  private handleDeliveryError(httpStatus: number, code: string): void {
    if (httpStatus === 401) {
      this.onSessionEnded();
      return;
    }
    switch (code) {
      case "delivery_day_full":
        status.announce("That day has just filled. Pick another.");
        break;
      case "delivery_day_closed":
        status.announce("That day has closed. Pick another.");
        break;
      case "delivery_day_has_places":
        status.announce("That day has a place now. Set it as your delivery day.");
        break;
      case "hub_unreachable":
        status.announce("Hub system unreachable. Your delivery day is unchanged. Try again.");
        break;
      default:
        status.announce("Something went wrong. Try again.");
    }
    void this.reRead();
  }

  private async joinLine(): Promise<void> {
    if (!(await this.ensureSignedIn())) return;
    const lock = this.activeLocks()[0];
    if (!lock || !this.chosenDate) return;
    status.announce("Joining the line…");
    const res = await apiJson<{ lock: LockJson }>(`/api/locks/${lock.id}/delivery/wait`, "POST", { date: this.chosenDate });
    if (!res.ok) {
      this.handleDeliveryError(res.fail.status, res.fail.code);
      return;
    }
    status.announce(`You are number ${res.data.lock.waitPosition} in line for ${dddDMon(this.chosenDate)}.`);
    void this.reRead();
  }

  private async leaveLine(): Promise<void> {
    if (!(await this.ensureSignedIn())) return;
    const lock = this.activeLocks()[0];
    if (!lock) return;
    const res = await apiJson<{ lock: LockJson }>(`/api/locks/${lock.id}/delivery/wait/leave`, "POST");
    if (!res.ok) {
      if (res.fail.status === 401) this.onSessionEnded();
      return;
    }
    status.announce("You have left the line.");
    void this.reRead();
  }

  private onSessionEnded(): void {
    status.announce("Your session has ended. Sign in to continue. Your choices are kept.", "session");
    this.me = { user: null, signedIn: false };
    void openSignIn(null).then((ok) => {
      if (ok) void this.reRead();
    });
  }
}

function hourLabel(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return "";
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? "am" : "pm"}`;
}

function dddDMon(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${wd} ${d} ${mon}`;
}

function boot(): void {
  if (!maybe("#lock-band")) return;
  new GaragePage().init();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

void qs;
