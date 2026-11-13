import { t, fmt, moneyText } from "../i18n.js";
import { ui } from "../boot.js";
import { api } from "../api.js";
import { toast, openDialog, closeDialog, status } from "../ui.js";
import { onEvent } from "../events.js";
import { onCleanup } from "../router.js";
import type { Page } from "../router.js";

type Cell = {
  room_type: string; date: string; rate_minor: number; allotment: number; left: number;
  min_stay: number; max_stay: number; closed_to_arrival: boolean; closed_to_departure: boolean;
  stop_sell: boolean; release_days: number;
};

const page: Page = {
  async render(main: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
    main.replaceChildren();
    const code = params.get("seg0") ?? path.split("/")[3];
    const match = /\/manage\/([^/]+)\//.exec(path);
    const propertyCode = match?.[1] ?? code;
    renderNav(main, propertyCode);
    let from = new URLSearchParams(location.search).get("from");
    if (!from) {
      const zoneRes = await api<{ zone: string }>(`/api/properties/${propertyCode}`);
      const zone = zoneRes.ok ? zoneRes.data.zone : "UTC";
      from = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
    }
    const wrap = document.createElement("div");
    wrap.className = "manager-page";
    main.appendChild(wrap);

    const h1 = document.createElement("h1");
    h1.textContent = ui("calendar.title");
    wrap.appendChild(h1);

    const earlier = document.createElement("button");
    earlier.textContent = ui("calendar.earlier");
    const later = document.createElement("button");
    later.textContent = ui("calendar.later");
    const nav = document.createElement("div");
    nav.append(earlier, later);
    wrap.appendChild(nav);

    const calWrap = document.createElement("div");
    calWrap.className = "calendar-wrap";
    wrap.appendChild(calWrap);

    let cells: Cell[] = [];
    let roomTypes: { code: string; name: string; rooms: number }[] = [];
    let anchor: { rt: string; date: string } | null = null;
    let selected: { rt: string; date: string }[] = [];

    const load = async (): Promise<void> => {
      const res = await api<{ room_types: typeof roomTypes; cells: Cell[] }>(`/api/manage/${propertyCode}/calendar?from=${from}&days=28`);
      if (!res.ok) {
        const p = document.createElement("p");
        p.textContent = res.status === 404 ? t("page.missing", { fmt: fmt() }) : t("page.forbidden", { fmt: fmt() });
        wrap.appendChild(p);
        return;
      }
      roomTypes = res.data.room_types;
      cells = res.data.cells;
      renderGrid();
    };

    const renderGrid = (): void => {
      calWrap.replaceChildren();
      const table = document.createElement("table");
      table.className = "rates-grid";
      table.setAttribute("role", "grid");
      table.setAttribute("aria-label", ui("calendar.title"));
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      const corner = document.createElement("th");
      hr.appendChild(corner);
      for (let i = 0; i < 28; i++) {
        const th = document.createElement("th");
        const date = addDays(from!, i);
        th.textContent = date.slice(8);
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const rt of roomTypes) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.setAttribute("role", "rowheader");
        th.textContent = rt.name;
        tr.appendChild(th);
        for (let i = 0; i < 28; i++) {
          const date = addDays(from!, i);
          const cell = cells.find((c) => c.room_type === rt.code && c.date === date);
          const td = document.createElement("td");
          td.dataset.date = date;
          td.dataset.roomType = rt.code;
          td.dataset.rateMinor = String(cell?.rate_minor ?? 0);
          td.dataset.allotment = String(cell?.allotment ?? 0);
          td.dataset.left = String(cell?.left ?? 0);
          td.setAttribute("role", "gridcell");
          const btn = document.createElement("button");
          btn.textContent = String(cell?.rate_minor ?? 0);
          btn.dataset.focusKey = `cal-${rt.code}-${date}`;
          if (cell?.stop_sell) td.classList.add("closed");
          td.appendChild(btn);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      calWrap.appendChild(table);

      // roving focus with arrow keys, Shift+arrow extends a rectangular selection
      const activeOf = (): HTMLElement => {
        const marked = table.querySelector<HTMLElement>("[data-active='true']");
        if (marked) return marked;
        const focused = table.querySelector<HTMLElement>("td:focus-within") ?? table.querySelector<HTMLElement>("td button:focus")?.parentElement as HTMLElement | null;
        return focused ?? table.querySelector<HTMLElement>("td button")?.parentElement as HTMLElement;
      };
      const setActive = (td: HTMLElement): void => {
        table.querySelectorAll("[data-active]").forEach((el) => el.removeAttribute("data-active"));
        td.setAttribute("data-active", "true");
        (td.querySelector("button") as HTMLButtonElement)?.focus();
      };
      table.addEventListener("keydown", (e) => {
        const rtl = document.documentElement.lang === "ar";
        const active = activeOf();
        if (!active) return;
        const rtl2 = rtl ? -1 : 1;
        let td: HTMLElement | null = active;
        if (e.key === "ArrowRight") td = nextCell(active, 1 * rtl2);
        else if (e.key === "ArrowLeft") td = nextCell(active, -1 * rtl2);
        else if (e.key === "ArrowDown") td = nextRow(active, 1);
        else if (e.key === "ArrowUp") td = nextRow(active, -1);
        else if (e.key === "Home") td = sameRowFirst(active);
        else if (e.key === "End") td = sameRowLast(active);
        else if (e.key === "Enter") {
          e.preventDefault();
          if (!anchor) {
            anchor = { rt: active.dataset.roomType!, date: active.dataset.date! };
            selected = [anchor];
          } else {
            const rect = rectBetween(anchor, { rt: active.dataset.roomType!, date: active.dataset.date! });
            selected = rect;
          }
          table.querySelectorAll("[aria-selected]").forEach((el) => el.removeAttribute("aria-selected"));
          for (const s of selected) {
            const el = table.querySelector(`td[data-room-type="${s.rt}"][data-date="${s.date}"]`);
            el?.setAttribute("aria-selected", "true");
          }
          openEditDialog(active, selected);
          return;
        } else return;
        e.preventDefault();
        if (td) {
          if (e.shiftKey && anchor) {
            const rect = rectBetween(anchor, { rt: td.dataset.roomType!, date: td.dataset.date! });
            selected = rect;
            table.querySelectorAll("[aria-selected]").forEach((el) => el.removeAttribute("aria-selected"));
            for (const s of selected) {
              const el = table.querySelector(`td[data-room-type="${s.rt}"][data-date="${s.date}"]`);
              el?.setAttribute("aria-selected", "true");
            }
          }
          setActive(td);
        }
      });
      table.addEventListener("click", (e) => {
        const td = (e.target as HTMLElement).closest("td");
        if (!td) return;
        if (!anchor) {
          anchor = { rt: td.dataset.roomType!, date: td.dataset.date! };
          selected = [anchor];
        } else {
          selected = rectBetween(anchor, { rt: td.dataset.roomType!, date: td.dataset.date! });
        }
        table.querySelectorAll("[aria-selected]").forEach((el) => el.removeAttribute("aria-selected"));
        for (const s of selected) {
          const el = table.querySelector(`td[data-room-type="${s.rt}"][data-date="${s.date}"]`);
          el?.setAttribute("aria-selected", "true");
        }
        setActive(td);
      });
    };

    const openEditDialog = (active: HTMLElement, sel: { rt: string; date: string }[]): void => {
      const first = cells.find((c) => c.room_type === active.dataset.roomType && c.date === active.dataset.date);
      const dlg = openDialog((body) => {
        body.dataset.role = "edit-nights";
        const title = document.createElement("h2");
        title.textContent = ui("calendar.edit_title");
        const problemsHost = document.createElement("div");
        const mk = (label: string, key: string, type = "number", value?: string | number) => {
          const lab = document.createElement("label");
          const input = document.createElement("input");
          input.type = type;
          input.dataset.field = key;
          if (value !== undefined) input.value = String(value);
          lab.append(document.createTextNode(label), input);
          body.appendChild(lab);
          return input;
        };
        const rate = mk(ui("calendar.rate"), "rate", "number", Math.round((first?.rate_minor ?? 0) / 100));
        const rooms = mk(ui("calendar.rooms"), "rooms", "number", first?.allotment ?? 0);
        const minStay = mk(ui("calendar.min"), "min_stay", "number", first?.min_stay ?? 1);
        const maxStay = mk(ui("calendar.max"), "max_stay", "number", first?.max_stay ?? 30);
        const mkCheck = (label: string, key: string, checked: boolean) => {
          const lab = document.createElement("label");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.dataset.field = key;
          cb.checked = checked;
          lab.append(document.createTextNode(label), cb);
          body.appendChild(lab);
          return cb;
        };
        const cta = mkCheck(ui("calendar.cta"), "closed_to_arrival", first?.closed_to_arrival === true);
        const ctd = mkCheck(ui("calendar.ctd"), "closed_to_departure", first?.closed_to_departure === true);
        const stop = mkCheck(ui("calendar.stop"), "stop_sell", first?.stop_sell === true);

        const weekdaysGroup = document.createElement("fieldset");
        weekdaysGroup.setAttribute("role", "group");
        weekdaysGroup.setAttribute("aria-label", ui("calendar.weekdays"));
        const legend = document.createElement("legend");
        legend.textContent = ui("calendar.weekdays");
        weekdaysGroup.appendChild(legend);
        const weekdayChecks: HTMLInputElement[] = [];
        for (let d = 1; d <= 7; d++) {
          const lab = document.createElement("label");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = true;
          weekdayChecks.push(cb);
          lab.append(cb, document.createTextNode(ui("weekday." + d)));
          weekdaysGroup.appendChild(lab);
        }
        body.append(title, problemsHost, weekdaysGroup);

        const seasonLabel = document.createElement("label");
        const seasonInput = document.createElement("input");
        seasonInput.type = "text";
        seasonInput.dataset.field = "season_name";
        seasonLabel.append(document.createTextNode(ui("calendar.season")), seasonInput);
        body.appendChild(seasonLabel);

        const actions = document.createElement("div");
        actions.className = "dialog-actions";
        const apply = document.createElement("button");
        apply.className = "primary";
        apply.textContent = ui("calendar.apply");
        const seasonNameSpan = document.createElement("span");
        actions.append(apply, seasonNameSpan);
        body.appendChild(actions);

        apply.addEventListener("click", async () => {
          apply.setAttribute("aria-busy", "true");
          const dates = sel.map((s) => s.date).sort();
          const res = await api<{ changed_nights: number; season: { name: string } | null }>(`/api/manage/${propertyCode}/nights`, {
            method: "PATCH",
            body: JSON.stringify({
              room_types: [...new Set(sel.map((s) => s.rt))],
              from: dates[0],
              to: dates[dates.length - 1],
              weekdays: weekdayChecks.map((cb, i) => cb.checked ? i + 1 : null).filter((x): x is number => x !== null),
              rate_minor: rate.value === "" ? undefined : Number(rate.value) * 100,
              rooms: rooms.value === "" ? undefined : Number(rooms.value),
              min_stay: minStay.value === "" ? undefined : Number(minStay.value),
              max_stay: maxStay.value === "" ? undefined : Number(maxStay.value),
              closed_to_arrival: cta.checked,
              closed_to_departure: ctd.checked,
              stop_sell: stop.checked,
              season_name: seasonInput.value || undefined
            })
          });
          apply.removeAttribute("aria-busy");
          if (!res.ok) {
            const fields = res.data.fields as Record<string, unknown>;
            problemsHost.replaceChildren();
            const region = document.createElement("div");
            region.className = "problems";
            region.setAttribute("role", "region");
            region.setAttribute("aria-label", ui("problems.title"));
            const h3 = document.createElement("h3");
            h3.textContent = t("problems.heading", { count_noun: "problem", n: Object.keys(fields ?? {}).length, fmt: fmt() });
            region.appendChild(h3);
            for (const [field, value] of Object.entries(fields ?? {})) {
              const entry = typeof value === "object" ? value as { code: string; n?: number } : { code: String(value), n: undefined };
              const a = document.createElement("a");
              a.href = "#";
              const label = field === "rate_minor" ? ui("calendar.rate") : field === "rooms" ? ui("calendar.rooms") : field === "max_stay" ? ui("calendar.max") : field === "season_name" ? ui("calendar.season") : field;
              a.textContent = `${label}: ${t(entry.code as Parameters<typeof t>[0], { n: entry.n, fmt: fmt() })}`;
              a.addEventListener("click", (e) => {
                e.preventDefault();
                const target = body.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
                target?.focus();
              });
              region.appendChild(a);
            }
            problemsHost.appendChild(region);
            return;
          }
          if (res.data.season) seasonNameSpan.textContent = res.data.season.name;
          toast(t("toast.nights_saved", { fmt: fmt() }));
          closeDialog(dlg);
          void load();
        });
      }, { opener: active.querySelector("button"), label: ui("calendar.edit_title"), onClose: () => { anchor = null; selected = []; } });
    };

    earlier.addEventListener("click", () => { from = addDays(from!, -28); void load(); });
    later.addEventListener("click", () => { from = addDays(from!, 28); void load(); });

    await load();

    const off = onEvent(() => { void load(); }, "availability");
    onCleanup(() => { off(); });

    function nextCell(td: HTMLElement, delta: number): HTMLElement | null {
      const idx = [...td.parentElement!.children].indexOf(td);
      const next = td.parentElement!.children[idx + delta];
      return (next as HTMLElement)?.dataset?.roomType ? next as HTMLElement : null;
    }
    function nextRow(td: HTMLElement, delta: number): HTMLElement | null {
      const row = td.parentElement as HTMLElement;
      const idx = [...row.children].indexOf(td);
      const nextRow2 = row.parentElement!.children[[...row.parentElement!.children].indexOf(row) + delta] as HTMLElement | undefined;
      return nextRow2?.children[idx] as HTMLElement | null ?? null;
    }
    function sameRowFirst(td: HTMLElement): HTMLElement | null {
      return td.parentElement!.children[1] as HTMLElement;
    }
    function sameRowLast(td: HTMLElement): HTMLElement | null {
      const row = td.parentElement!;
      return row.children[row.children.length - 1] as HTMLElement;
    }
    function rectBetween(a: { rt: string; date: string }, b: { rt: string; date: string }): { rt: string; date: string }[] {
      const codes = roomTypes.map((r) => r.code);
      const rts = codes.filter((c) => c >= (a.rt < b.rt ? a.rt : b.rt) && c <= (a.rt < b.rt ? b.rt : a.rt));
      const d0 = a.date < b.date ? a.date : b.date;
      const d1 = a.date < b.date ? b.date : a.date;
      const out: { rt: string; date: string }[] = [];
      for (const rt of rts) {
        for (let t = Date.parse(d0); t <= Date.parse(d1); t += 86400000) {
          out.push({ rt, date: new Date(t).toISOString().slice(0, 10) });
        }
      }
      return out;
    }
  }
};

function renderNav(main: HTMLElement, propertyCode: string): void {
  const nav = document.createElement("nav");
  nav.className = "manager-nav";
  for (const [sub, key] of [["calendar", "calendar.title"], ["reservations", "reservations.title"], ["import", "import.file"], ["statements", "statements.title"]] as const) {
    const a = document.createElement("a");
    a.href = `/manage/${propertyCode}/${sub}`;
    a.textContent = ui(key);
    if (location.pathname.endsWith(sub)) a.setAttribute("aria-current", "page");
    nav.appendChild(a);
  }
  main.appendChild(nav);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default page;
