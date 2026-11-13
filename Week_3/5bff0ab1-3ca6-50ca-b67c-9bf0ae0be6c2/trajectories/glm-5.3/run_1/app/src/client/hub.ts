// The hub console: the day sheet, held units and stock, with stock counting.
// The day sheet follows today across midnight IST unless another date is chosen.
import {
  api,
  apiJson,
  maybe,
  pollIdentity,
  status,
  type Me,
} from "./core";
import { openSignIn } from "./auth";

interface DaySheetReply {
  hub: string;
  date: string;
  dayLabel: string;
  dates: { date: string; dayLabel: string }[];
  rows: {
    kind: string;
    id: string;
    label: string;
    riderName: string;
    model: string;
    finish: string | null;
    licenceLast4: string | null;
    state: string;
    actions: string[];
  }[];
}

interface HeldUnitsReply {
  rows: {
    id: string;
    riderName: string;
    model: string;
    finish: string;
    state: string;
    expiresLabel: string | null;
    deliveryDate: string | null;
    waitingFor: string | null;
    actions: string[];
  }[];
}

interface StockReply {
  hub: string;
  counting: boolean;
  stockAsOf: string;
  stockAsOfLabel: string;
  units: { model: string; finish: string; onHand: number; held: number; unitsLeft: number }[];
}

const MODEL_NAMES: Record<string, string> = { "megh-349": "Megh 349", "desh-648": "Desh 648" };
const FINISH_NAMES: Record<string, string> = { "monsoon-slate": "Monsoon Slate", kesar: "Kesar", "raat-black": "Raat Black" };

class HubPage {
  me: Me = { user: null, signedIn: false };
  date = "";
  counting = false;
  typedCounts: Record<string, string> = {};

  init(): void {
    const url = new URL(location.href);
    const d = url.searchParams.get("date");
    this.date = d !== null && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
    this.bindControls();
    pollIdentity(async (me) => {
      const changedAccount = me.user?.id !== this.me.user?.id;
      this.me = me;
      if (!me.signedIn) {
        if (location.pathname === "/hub") {
          void openSignIn(null);
        }
        return;
      }
      if (changedAccount) this.typedCounts = {};
      void this.reRead();
    });
    void this.reRead();
  }

  private bindControls(): void {
    maybe<HTMLSelectElement>("#sheet-date")?.addEventListener("change", (e) => {
      this.date = (e.target as HTMLSelectElement).value;
      this.writeUrl();
      void this.loadDaySheet();
    });
    maybe<HTMLButtonElement>("#go-today")?.addEventListener("click", () => {
      this.date = "";
      this.writeUrl();
      void this.loadDaySheet();
    });
    maybe<HTMLButtonElement>("#sheet-go-today")?.addEventListener("click", () => {
      this.date = "";
      this.writeUrl();
      void this.loadDaySheet();
    });
    maybe<HTMLButtonElement>("#start-count")?.addEventListener("click", () => void this.startCount());
    maybe<HTMLButtonElement>("#finish-count")?.addEventListener("click", () => void this.finishCount());
  }

  private writeUrl(): void {
    const url = new URL(location.href);
    if (this.date) url.searchParams.set("date", this.date);
    else url.searchParams.delete("date");
    try {
      history.replaceState(null, "", url.pathname + (this.date ? `?date=${this.date}` : ""));
    } catch {
      /* ignore */
    }
    const goToday = maybe<HTMLButtonElement>("#go-today");
    if (goToday) goToday.hidden = !this.date;
  }

  private async reRead(): Promise<void> {
    await Promise.all([this.loadDaySheet(), this.loadHeldUnits(), this.loadStock()]);
  }

  private async loadDaySheet(): Promise<void> {
    const res = await api<DaySheetReply>(`/api/hub/day-sheet${this.date ? `?date=${this.date}` : ""}`);
    if (!res.ok) {
      if (res.fail.status === 401) this.onSessionEnded();
      return;
    }
    const sheet = res.data;
    this.date = this.date || sheet.date;
    const select = maybe<HTMLSelectElement>("#sheet-date");
    if (select) {
      while (select.options.length < sheet.dates.length) select.add(new Option("", ""));
      sheet.dates.forEach((d, i) => {
        const opt = select.options[i];
        opt.value = d.date;
        opt.textContent = d.dayLabel;
      });
      while (select.options.length > sheet.dates.length) select.remove(select.options.length - 1);
      // a chosen date that rolls out of dates stays as an extra option
      if (!sheet.dates.some((d) => d.date === this.date)) {
        select.add(new Option(this.date, this.date));
      }
      select.value = this.date;
    }
    const statement = maybe<HTMLElement>("#hub-statement");
    if (statement) {
      const hubName = { pune: "Pune", bengaluru: "Bengaluru", gurugram: "Gurugram", kochi: "Kochi" }[sheet.hub] ?? sheet.hub;
      statement.textContent = `${hubName}, ${sheet.dayLabel}.`;
    }
    this.renderDaySheet(sheet);
    const goToday = maybe<HTMLButtonElement>("#go-today");
    if (goToday) goToday.hidden = !this.date;
  }

  private renderDaySheet(sheet: DaySheetReply): void {
    const body = maybe<HTMLElement>("#day-sheet-body");
    if (!body) return;
    const empty = maybe<HTMLElement>("#day-empty");
    if (empty) empty.hidden = sheet.rows.length > 0;
    // keep the same rows: update in place
    const existing = Array.from(body.querySelectorAll<HTMLTableRowElement>("tr"));
    while (existing.length < sheet.rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="c-time"></td><td class="c-rider"></td><td class="c-model"></td><td class="c-licence"></td><td class="c-state"></td><td class="c-actions"></td>`;
      body.appendChild(tr);
      existing.push(tr);
    }
    while (existing.length > sheet.rows.length) {
      existing.pop()?.remove();
    }
    sheet.rows.forEach((row, i) => {
      const tr = existing[i];
      tr.dataset.rowId = row.id;
      (tr.querySelector(".c-time") as HTMLElement).textContent = row.label;
      (tr.querySelector(".c-rider") as HTMLElement).textContent = row.riderName;
      (tr.querySelector(".c-model") as HTMLElement).textContent = row.finish !== null ? `${MODEL_NAMES[row.model] ?? row.model} ${FINISH_NAMES[row.finish] ?? row.finish}` : MODEL_NAMES[row.model] ?? row.model;
      (tr.querySelector(".c-licence") as HTMLElement).textContent = row.licenceLast4 ?? "";
      (tr.querySelector(".c-state") as HTMLElement).textContent = row.state.replace(/_/g, " ");
      const actionsCell = tr.querySelector(".c-actions") as HTMLElement;
      // mark buttons exist only for the actions the server lists
      const wanted = row.actions.map((a) => `${a}:${row.id}`).join(",");
      if (actionsCell.dataset.wanted !== wanted) {
        actionsCell.dataset.wanted = wanted;
        actionsCell.innerHTML = "";
        for (const action of row.actions) {
          const btn = document.createElement("button");
          btn.className = "secondary";
          if (action === "ridden") btn.textContent = `Mark ridden ${row.riderName}`;
          else if (action === "no_show") btn.textContent = `Mark no-show ${row.riderName}`;
          else if (action === "delivered") btn.textContent = `Mark delivered ${row.riderName}`;
          btn.addEventListener("click", () => void this.markRide(row.id, action));
          actionsCell.appendChild(btn);
        }
      }
    });
  }

  private async markRide(id: string, action: string): Promise<void> {
    if (action === "ridden" || action === "no_show") {
      const res = await apiJson(`/api/hub/rides/${id}/mark`, "POST", { outcome: action });
      if (!res.ok) {
        if (res.fail.code === "illegal_state") status.announce("That has already been marked.");
        else if (res.fail.status === 401) this.onSessionEnded();
        else status.announce("Something went wrong. Try again.");
        return;
      }
      const name = (res.data as { ride: { state: string } }).ride.state === "ridden" ? "ridden" : "no-show";
      status.announce(`${name}.`);
      void this.reRead();
      return;
    }
    if (action === "delivered") {
      const res = await apiJson(`/api/hub/locks/${id}/delivered`, "POST");
      if (!res.ok) {
        if (res.fail.code === "illegal_state") status.announce("That has already been marked.");
        else if (res.fail.status === 401) this.onSessionEnded();
        else status.announce("Something went wrong. Try again.");
        return;
      }
      status.announce("Marked delivered.");
      void this.reRead();
    }
  }

  private async loadHeldUnits(): Promise<void> {
    const res = await api<HeldUnitsReply>("/api/hub/held-units");
    if (!res.ok) return;
    const body = maybe<HTMLElement>("#held-units-body");
    if (!body) return;
    const empty = maybe<HTMLElement>("#held-empty");
    if (empty) empty.hidden = res.data.rows.length > 0;
    const existing = Array.from(body.querySelectorAll<HTMLTableRowElement>("tr"));
    while (existing.length < res.data.rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="c-rider"></td><td class="c-model"></td><td class="c-finish"></td><td class="c-ends"></td><td class="c-state"></td><td class="c-actions"></td>`;
      body.appendChild(tr);
      existing.push(tr);
    }
    while (existing.length > res.data.rows.length) {
      existing.pop()?.remove();
    }
    res.data.rows.forEach((row, i) => {
      const tr = existing[i];
      tr.dataset.rowId = row.id;
      (tr.querySelector(".c-rider") as HTMLElement).textContent = row.riderName;
      (tr.querySelector(".c-model") as HTMLElement).textContent = MODEL_NAMES[row.model] ?? row.model;
      (tr.querySelector(".c-finish") as HTMLElement).textContent = FINISH_NAMES[row.finish] ?? row.finish;
      (tr.querySelector(".c-ends") as HTMLElement).textContent = row.expiresLabel ?? "No expiry";
      (tr.querySelector(".c-state") as HTMLElement).textContent = row.state.replace(/_/g, " ");
      const actionsCell = tr.querySelector(".c-actions") as HTMLElement;
      const wanted = row.actions.map((a) => `${a}:${row.id}`).join(",");
      if (actionsCell.dataset.wanted !== wanted) {
        actionsCell.dataset.wanted = wanted;
        actionsCell.innerHTML = "";
        for (const action of row.actions) {
          const btn = document.createElement("button");
          btn.className = "secondary";
          if (action === "confirm") btn.textContent = `Confirm unit ${row.riderName}`;
          else if (action === "refuse") btn.textContent = `Refuse unit ${row.riderName}`;
          else if (action === "withdraw") btn.textContent = `Withdraw unit ${row.riderName}`;
          btn.addEventListener("click", () => void this.heldUnitAction(row.id, action, row.riderName));
          actionsCell.appendChild(btn);
        }
      }
    });
  }

  private async heldUnitAction(id: string, action: string, name: string): Promise<void> {
    const res = await apiJson(`/api/hub/locks/${id}/${action}`, "POST");
    if (!res.ok) {
      if (res.fail.code === "illegal_state") status.announce("That has already been marked.");
      else if (res.fail.status === 503) status.announce("Hub system unreachable. Nothing was changed. Try again.");
      else if (res.fail.status === 401) this.onSessionEnded();
      else status.announce("Something went wrong. Try again.");
      return;
    }
    if (action === "confirm") status.announce(`${name}'s unit confirmed.`);
    else if (action === "refuse") status.announce(`${name}'s unit refused.`);
    else if (action === "withdraw") status.announce(`${name}'s unit withdrawn.`);
    void this.reRead();
  }

  private async loadStock(): Promise<void> {
    const res = await api<StockReply>("/api/hub/stock");
    if (!res.ok) return;
    const body = maybe<HTMLElement>("#stock-body");
    if (!body) return;
    const stock = res.data;
    this.counting = stock.counting;
    const startBtn = maybe<HTMLButtonElement>("#start-count");
    const finishBtn = maybe<HTMLButtonElement>("#finish-count");
    if (startBtn) startBtn.hidden = this.counting;
    if (finishBtn) finishBtn.hidden = !this.counting;
    const existing = Array.from(body.querySelectorAll<HTMLTableRowElement>("tr"));
    while (existing.length < stock.units.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="c-model"></td><td class="c-finish"></td><td class="c-onhand"></td><td class="c-held"></td><td class="c-left"></td>`;
      body.appendChild(tr);
      existing.push(tr);
    }
    while (existing.length > stock.units.length) {
      existing.pop()?.remove();
    }
    stock.units.forEach((unit, i) => {
      const tr = existing[i];
      const key = `${unit.model}:${unit.finish}`;
      tr.dataset.key = key;
      (tr.querySelector(".c-model") as HTMLElement).textContent = MODEL_NAMES[unit.model] ?? unit.model;
      (tr.querySelector(".c-finish") as HTMLElement).textContent = FINISH_NAMES[unit.finish] ?? unit.finish;
      (tr.querySelector(".c-held") as HTMLElement).textContent = String(unit.held);
      (tr.querySelector(".c-left") as HTMLElement).textContent = String(unit.unitsLeft);
      const onHandCell = tr.querySelector(".c-onhand") as HTMLElement;
      if (this.counting) {
        let input = onHandCell.querySelector<HTMLInputElement>("input");
        if (!input) {
          onHandCell.textContent = "";
          const field = document.createElement("input");
          field.type = "number";
          field.min = "0";
          field.setAttribute("aria-label", `${MODEL_NAMES[unit.model]} ${FINISH_NAMES[unit.finish]} on hand`);
          onHandCell.appendChild(field);
          field.addEventListener("input", () => {
            this.typedCounts[key] = field.value;
          });
          input = field;
        }
        input.value = this.typedCounts[key] ?? String(unit.onHand);
      } else {
        if (onHandCell.querySelector("input")) onHandCell.textContent = String(unit.onHand);
        else onHandCell.textContent = String(unit.onHand);
      }
    });
  }

  private async startCount(): Promise<void> {
    const res = await apiJson<StockReply>("/api/hub/stock-count/start", "POST");
    if (!res.ok) {
      if (res.fail.status === 401) this.onSessionEnded();
      return;
    }
    status.announce("Stock count started.");
    void this.reRead();
  }

  private async finishCount(): Promise<void> {
    const body = maybe<HTMLElement>("#stock-body");
    if (!body) return;
    const units: { model: string; finish: string; onHand: number }[] = [];
    let bad = false;
    body.querySelectorAll<HTMLTableRowElement>("tr").forEach((tr) => {
      const key = tr.dataset.key ?? "";
      const [model, finish] = key.split(":");
      const input = tr.querySelector<HTMLInputElement>(".c-onhand input");
      const raw = input?.value ?? "";
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n) || n < 0) {
        bad = true;
      }
      units.push({ model, finish, onHand: Number.isInteger(n) ? n : 0 });
    });
    if (bad) {
      // a 422 keeps the count open with the typed values
      const err = maybe<HTMLElement>("#count-error");
      if (err) {
        err.textContent = "Enter a whole number of 0 or more.";
        err.hidden = false;
      }
      return;
    }
    const res = await apiJson<StockReply>("/api/hub/stock-count/finish", "POST", { units });
    if (!res.ok) {
      if (res.fail.code === "invalid_body") {
        status.announce("Stock count could not be saved. Check the counts.");
        const err = maybe<HTMLElement>("#count-error");
        if (err) {
          err.textContent = "Enter a whole number of 0 or more.";
          err.hidden = false;
        }
      } else if (res.fail.status === 503) {
        status.announce("Hub system unreachable. Nothing was changed. Try again.");
      } else if (res.fail.status === 401) {
        this.onSessionEnded();
      }
      return;
    }
    status.announce("Stock count saved.");
    const err = maybe<HTMLElement>("#count-error");
    if (err) err.hidden = true;
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

function boot(): void {
  if (!maybe("#day-sheet-body")) return;
  new HubPage().init();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
