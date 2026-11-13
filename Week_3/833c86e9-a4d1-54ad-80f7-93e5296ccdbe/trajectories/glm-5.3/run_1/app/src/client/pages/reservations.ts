import { t, fmt, moneyText } from "../i18n.js";
import { ui } from "../boot.js";
import { api } from "../api.js";
import type { Page } from "../router.js";

const page: Page = {
  async render(main: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
    main.replaceChildren();
    const match = /\/manage\/([^/]+)\//.exec(path);
    const propertyCode = match?.[1] ?? params.get("seg0") ?? "";
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

    const wrap = document.createElement("div");
    wrap.className = "manager-page";
    main.appendChild(wrap);

    const res = await api<{ code: string; surname: string; arrival: string; departure: string; rooms: number; total_minor: number; state: string }[]>(`/api/manage/${propertyCode}/reservations`);
    if (!res.ok) {
      const p = document.createElement("p");
      p.textContent = res.status === 404 ? t("page.missing", { fmt: fmt() }) : t("page.forbidden", { fmt: fmt() });
      wrap.appendChild(p);
      return;
    }
    const h1 = document.createElement("h1");
    h1.textContent = ui("reservations.title");
    wrap.appendChild(h1);
    const exportLink = document.createElement("a");
    exportLink.href = `/api/manage/${propertyCode}/reservations.csv`;
    exportLink.textContent = ui("reservations.export");
    wrap.appendChild(exportLink);
    const table = document.createElement("table");
    table.className = "data";
    table.setAttribute("aria-label", ui("reservations.title"));
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const key of ["reservations.code", "reservations.surname", "reservations.arrival", "reservations.departure", "reservations.rooms", "reservations.total"]) {
      const th = document.createElement("th");
      th.textContent = ui(key);
      if (key.endsWith("total")) th.className = "num";
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const r of res.data) {
      const row = document.createElement("tr");
      const cells: { key: string; value: string }[] = [
        { key: "code", value: r.code },
        { key: "surname", value: r.surname },
        { key: "arrival", value: r.arrival },
        { key: "departure", value: r.departure },
        { key: "rooms", value: String(r.rooms) },
        { key: "total", value: String(r.total_minor) }
      ];
      for (const { key, value } of cells) {
        const td = document.createElement("td");
        if (key === "total") {
          td.className = "num";
          td.textContent = moneyText(Number(value), "EUR");
        } else {
          td.textContent = String(value);
        }
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
  }
};

export default page;
