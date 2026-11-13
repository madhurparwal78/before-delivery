import { t, fmt, serverNow } from "../i18n.js";
import { ui } from "../boot.js";
import { openDialog, status } from "../ui.js";
import { api } from "../api.js";

export type DestOption = { code: string; name: string; zone: string; property_count: number; cx?: number; cy?: number };

const DEBOUNCE = Number(process.env.KIP_TYPE_DEBOUNCE_MS);

/**
 * The destination combobox: typing filters destinations after the published
 * debounce, arrows move the active option, Enter picks it, Escape closes then
 * clears.
 */
export function destinationCombobox(selected: DestOption | null, onPick: (d: DestOption | null) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dest-combobox";
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.focusKey = "dest";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "dest-list");
  input.setAttribute("aria-label", ui("search.destination"));
  if (selected) input.value = selected.name;
  const list = document.createElement("ul");
  list.id = "dest-list";
  list.className = "dest-list";
  list.setAttribute("role", "listbox");
  list.style.display = "none";
  wrap.append(input, list);

  let options: DestOption[] = [];
  let active = -1;

  const close = () => {
    list.style.display = "none";
    input.setAttribute("aria-expanded", "false");
    active = -1;
    input.removeAttribute("aria-activedescendant");
  };

  const renderList = () => {
    list.replaceChildren();
    options.forEach((o, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = "dest-opt-" + i;
      li.textContent = `${o.name}, ${o.property_count === 1 ? "1 property" : o.property_count + " properties"}`;
      if (i === active) {
        li.setAttribute("aria-selected", "true");
        input.setAttribute("aria-activedescendant", li.id);
      }
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(o);
      });
      list.appendChild(li);
    });
    list.style.display = "block";
    input.setAttribute("aria-expanded", "true");
  };

  const choose = (o: DestOption) => {
    input.value = o.name;
    input.dataset.code = o.code;
    close();
    onPick(o);
  };

  let timer: number | undefined;
  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(async () => {
      input.setAttribute("aria-busy", "true");
      const res = await api<DestOption[]>(`/api/destinations?q=${encodeURIComponent(input.value)}`);
      input.removeAttribute("aria-busy");
      if (res.ok) {
        options = res.data;
        active = options.length > 0 ? 0 : -1;
        if (options.length > 0) renderList(); else close();
      }
    }, DEBOUNCE);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (options.length === 0) return;
      e.preventDefault();
      active = e.key === "ArrowDown" ? Math.min(options.length - 1, active + 1) : Math.max(0, active - 1);
      renderList();
    } else if (e.key === "Enter") {
      if (list.style.display === "block" && options[active]) {
        e.preventDefault();
        choose(options[active]);
      }
    } else if (e.key === "Escape") {
      if (list.style.display === "block") {
        e.preventDefault();
        close();
      } else {
        input.value = "";
        input.dataset.code = "";
        onPick(null);
      }
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
  return wrap;
}

/** The combobox's current selection, by code or exact name match. */
export function destValue(wrap: HTMLElement, options: DestOption[]): DestOption | null {
  const input = wrap.querySelector<HTMLInputElement>("input");
  if (!input) return null;
  const code = input.dataset.code ?? "";
  const byCode = options.find((o) => o.code === code);
  if (byCode) return byCode;
  const name = input.value.trim().toLowerCase();
  return options.find((o) => o.name.toLowerCase() === name) ?? null;
}

/** Adults and children spinbuttons, with an age combobox per child. */
export function partyControls(adults: number, ages: number[], onChange: (adults: number, ages: number[]) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "party-controls";
  const agesWrap = document.createElement("div");
  agesWrap.className = "ages";
  let adultsNow = adults;
  let agesNow = [...ages];

  const spin = (label: string, min: number, max: number, value: number, key: string, onSet: (n: number) => void) => {
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.dataset.focusKey = key;
    input.setAttribute("role", "spinbutton");
    input.setAttribute("aria-label", label);
    input.setAttribute("aria-valuemin", String(min));
    input.setAttribute("aria-valuemax", String(max));
    input.setAttribute("aria-valuenow", String(value));
    const clamp = (n: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? Math.floor(n) : min));
    const set = (n: number) => {
      const v = clamp(n);
      input.value = String(v);
      input.setAttribute("aria-valuenow", String(v));
      onSet(v);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); set(Number(input.value) + 1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); set(Number(input.value) - 1); }
      else if (e.key === "Home") { e.preventDefault(); set(min); }
      else if (e.key === "End") { e.preventDefault(); set(max); }
    });
    input.addEventListener("change", () => set(Number(input.value)));
    return input;
  };

  const renderAges = () => {
    agesWrap.replaceChildren();
    agesNow.forEach((age, i) => {
      const sel = document.createElement("select");
      sel.dataset.focusKey = "age-" + (i + 1);
      sel.setAttribute("aria-label", `${ui("search.age")} ${i + 1}`);
      for (let a = 0; a <= 17; a++) {
        const opt = document.createElement("option");
        opt.value = String(a);
        opt.textContent = String(a);
        sel.appendChild(opt);
      }
      sel.value = String(age);
      sel.addEventListener("change", () => {
        agesNow[i] = Number(sel.value);
        onChange(adultsNow, agesNow);
      });
      agesWrap.appendChild(sel);
    });
  };

  wrap.append(
    spin(ui("search.adults"), 1, 16, adults, "adults", (n) => { adultsNow = n; onChange(adultsNow, agesNow); }),
    spin(ui("search.children"), 0, 8, ages.length, "children", (n) => {
      agesNow = agesNow.slice(0, n);
      while (agesNow.length < n) agesNow.push(8);
      renderAges();
      onChange(adultsNow, agesNow);
    }),
    agesWrap
  );
  renderAges();
  return wrap;
}

export type DayInfo = {
  date: string;
  available: boolean;
  from_minor: number;
  min_stay: number;
  reason: { code: string; date?: string; n?: number } | null;
  after_start: "before" | "short" | null;
};

/** Day-picker context used by the shared label builders. */
let pickerCtx = { zone: "UTC", cur: "EUR" };

export function setPickerContext(zone: string, cur: string): void {
  pickerCtx = { zone, cur };
}

export function reasonText(reason: DayInfo["reason"] | null): string {
  if (!reason) return "";
  const f = fmt();
  const map: Record<string, { key: Parameters<typeof t>[0]; noun: "day" | "night" }> = {
    release: { key: "reason.release", noun: "day" },
    no_arrival: { key: "reason.no_arrival", noun: "night" },
    no_departure: { key: "reason.no_departure", noun: "night" },
    min_stay: { key: "reason.min_stay", noun: "night" },
    max_stay: { key: "reason.max_stay", noun: "night" },
    stop_sell: { key: "reason.stop_sell", noun: "night" },
    sold_out: { key: "reason.sold_out", noun: "night" }
  };
  const entry = map[reason.code];
  if (!entry) return "";
  const out = t(entry.key, {
    date: reason.date ? f.date(reason.date, pickerCtx.zone) : "",
    n: reason.n,
    count_noun: entry.noun,
    fmt: f
  });
  return out.endsWith(".") ? out : out;
}

export function dayLabel(info: DayInfo): string {
  const f = fmt();
  if (info.after_start === "before") return t("day.before", { date: f.date(info.date, pickerCtx.zone), fmt: f });
  if (info.after_start === "short") return t("day.short", { date: f.date(info.date, pickerCtx.zone), count_noun: "night", n: info.min_stay, fmt: f });
  if (info.available) {
    const major = Math.round(info.from_minor / 10 ** decimalsOf(pickerCtx.cur));
    return t("day.available", { date: f.date(info.date, pickerCtx.zone), n: major, currency: pickerCtx.cur as "EUR", count_noun: "night", nights: info.min_stay, fmt: f });
  }
  return t("day.blocked", { date: f.date(info.date, pickerCtx.zone), reason: reasonText(info.reason), fmt: f });
}

/**
 * The date picker dialog: day buttons labelled with availability, price and
 * minimum stay or the blocking reason, and a roving tab stop across the grid.
 */
export function openDatePicker(opts: {
  opener: HTMLElement;
  dest?: string | undefined;
  property?: string | undefined;
  zone: string;
  cur: string;
  months?: number | undefined;
  arrival?: string | null | undefined;
  departure?: string | null | undefined;
  onPicked: (inDate: string | null, outDate: string | null) => void;
}): void {
  pickerCtx = { zone: opts.zone, cur: opts.cur };
  const months = opts.months ?? (window.innerWidth < 768 ? 1 : 2);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: opts.zone }).format(serverNow());
  const weekStart = document.documentElement.lang === "ar" ? 6 : 1;
  let viewMonth = monthOf(opts.arrival ?? today);
  let arrival: string | null = opts.arrival ?? null;
  let departure: string | null = opts.departure ?? null;
  let focusedDay: string | null = null;
  const cache = new Map<string, DayInfo>();

  const dlg = openDialog((body) => {
    const title = document.createElement("h2");
    title.textContent = ui("picker.title");
    const monthsEl = document.createElement("div");
    monthsEl.className = "dp-months";
    const help = document.createElement("div");
    help.className = "status-line";
    help.setAttribute("role", "status");
    help.dataset.status = "date-help";
    body.append(title, monthsEl, help);
    void rerender(monthsEl);
  }, {
    opener: opts.opener,
    label: ui("picker.title"),
    onClose: () => opts.onPicked(arrival, departure)
  });

  async function loadDays(from: string, to: string): Promise<void> {
    const target = opts.dest ? `dest=${opts.dest}` : `property=${opts.property}`;
    const start = arrival ? `&start=${arrival}` : "";
    const res = await api<{ days: DayInfo[] }>(`/api/dates?${target}&from=${from}&to=${to}&cur=${opts.cur}&lang=${document.documentElement.lang}${start}`);
    if (res.ok) for (const d of res.data.days) cache.set(d.date, d);
  }

  async function rerender(monthsEl: HTMLElement): Promise<void> {
    monthsEl.replaceChildren();
    for (let m = 0; m < months; m++) {
      monthsEl.appendChild(await renderMonth(addMonths(viewMonth, m)));
    }
    const target = focusedDay ?? arrival ?? today;
    const btn = dlg.querySelector<HTMLButtonElement>(`button[data-date="${target}"]`) ?? dlg.querySelector<HTMLButtonElement>(".day button");
    btn?.focus();
  }

  async function renderMonth(ym: string): Promise<HTMLElement> {
    const [y, m] = ym.split("-").map(Number);
    const monthStart = `${ym}-01`;
    const monthEnd = lastDay(y, m);
    await loadDays(monthStart, monthEnd);
    const wrap = document.createElement("div");
    wrap.className = "dp-month";
    const head = document.createElement("div");
    head.className = "dp-head";
    if (months === 2 || m === 1) {
      const prev = document.createElement("button");
      prev.dataset.focusKey = "dp-prev";
      prev.textContent = ui("picker.prev");
      prev.addEventListener("click", () => { viewMonth = addMonths(viewMonth, -1); void rerender(monthsElOf()); });
      head.appendChild(prev);
    }
    const label = document.createElement("h3");
    label.textContent = fmt().monthYear(monthStart, opts.zone);
    head.appendChild(label);
    if (months === 2 || m === 1) {
      const next = document.createElement("button");
      next.dataset.focusKey = "dp-next";
      next.textContent = ui("picker.next");
      next.addEventListener("click", () => { viewMonth = addMonths(viewMonth, 1); void rerender(monthsElOf()); });
      head.appendChild(next);
    }
    const grid = document.createElement("div");
    grid.className = "dp-grid";
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", fmt().monthYear(monthStart, opts.zone));
    for (let i = 0; i < 7; i++) {
      const idx = ((i + weekStart) % 7) + 1;
      const dow = document.createElement("div");
      dow.className = "dow";
      dow.textContent = ui("weekday." + idx).slice(0, 3);
      grid.appendChild(dow);
    }
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() - weekStart + 7) % 7;
    for (let i = 0; i < lead; i++) grid.appendChild(document.createElement("div"));
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= dim; d++) {
      const date = `${ym}-${String(d).padStart(2, "0")}`;
      const cell = document.createElement("div");
      cell.className = "day";
      cell.setAttribute("role", "gridcell");
      cell.dataset.date = date;
      const btn = document.createElement("button");
      btn.textContent = String(d);
      btn.dataset.date = date;
      const info = cache.get(date);
      if (info) {
        btn.setAttribute("aria-label", dayLabel(info));
        if (!info.available) cell.classList.add("unavailable");
      }
      if (arrival && date === arrival) cell.setAttribute("aria-selected", "true");
      if (arrival && departure && date > arrival && date < departure) cell.setAttribute("aria-selected", "true");
      btn.addEventListener("click", () => onDay(date, info ?? null));
      cell.appendChild(btn);
      grid.appendChild(cell);
    }
    wrap.append(head, grid);
    return wrap;
  }

  const monthsElOf = (): HTMLElement => dlg.querySelector<HTMLElement>(".dp-months") as HTMLElement;

  function onDay(date: string, info: DayInfo | null): void {
    focusedDay = date;
    if (info && !info.available) {
      status("date-help", dayLabel(info));
      return;
    }
    if (!arrival || departure) {
      arrival = date;
      departure = null;
      status("date-help", t("date.end", { date: fmt().date(date, opts.zone), count_noun: "night", n: info?.min_stay ?? 1, fmt: fmt() }));
      void rerender(monthsElOf());
      return;
    }
    if (date === arrival) return;
    if (date < arrival) {
      arrival = date;
      departure = null;
      void rerender(monthsElOf());
      return;
    }
    departure = date;
    dlg.close();
  }

  dlg.addEventListener("keydown", (e) => {
    if (!focusedDay) return;
    const rtl = document.documentElement.lang === "ar";
    let delta = 0;
    if (e.key === "ArrowLeft") delta = rtl ? 1 : -1;
    else if (e.key === "ArrowRight") delta = rtl ? -1 : 1;
    else if (e.key === "ArrowUp") delta = -7;
    else if (e.key === "ArrowDown") delta = 7;
    else if (e.key === "PageUp") {
      e.preventDefault();
      viewMonth = addMonths(viewMonth, e.shiftKey ? -12 : -1);
      void rerender(monthsElOf());
      return;
    } else if (e.key === "PageDown") {
      e.preventDefault();
      viewMonth = addMonths(viewMonth, e.shiftKey ? 12 : 1);
      void rerender(monthsElOf());
      return;
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const btns = [...dlg.querySelectorAll<HTMLButtonElement>(".day button")];
      (e.key === "Home" ? btns[0] : btns[btns.length - 1])?.focus();
      return;
    } else {
      return;
    }
    e.preventDefault();
    const next = shiftDay(focusedDay, delta);
    const btn = dlg.querySelector<HTMLButtonElement>(`button[data-date="${next}"]`);
    if (btn) { focusedDay = next; btn.focus(); }
  });
}

function decimalsOf(c: string): number {
  return c === "JPY" ? 0 : c === "KWD" ? 3 : 2;
}
function monthOf(date: string): string { return date.slice(0, 7); }
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function lastDay(y: number, m: number): string {
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function shiftDay(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
