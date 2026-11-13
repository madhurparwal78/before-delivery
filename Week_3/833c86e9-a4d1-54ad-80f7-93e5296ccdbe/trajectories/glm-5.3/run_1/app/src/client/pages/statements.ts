import { t, fmt, moneyText } from "../i18n.js";
import { ui } from "../boot.js";
import { api } from "../api.js";
import { outageBand } from "../ui.js";
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

    const h1 = document.createElement("h1");
    h1.textContent = ui("statements.title");
    wrap.appendChild(h1);

    const monthLabel = document.createElement("label");
    const monthSel = document.createElement("select");
    monthSel.setAttribute("aria-label", ui("statements.month"));
    monthLabel.append(document.createTextNode(ui("statements.month")), monthSel);
    wrap.appendChild(monthLabel);

    const tableHost = document.createElement("div");
    wrap.appendChild(tableHost);
    const downloadHost = document.createElement("div");
    wrap.appendChild(downloadHost);

    // months from the first booking month to the current property-local month, newest first
    const first = await api<{ month: string }[]>(`/api/manage/${propertyCode}/reservations`).then((r) => r.ok ? r.data : []);
    const months: string[] = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }
    for (const m of months) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = fmt().monthYear(`${m}-01`, "UTC");
      monthSel.appendChild(opt);
    }

    const load = async (): Promise<void> => {
      const ym = monthSel.value;
      const res = await api<{ month: string; lines: { code: string; kind: string; base_minor: number; commission_minor: number }[]; total_base_minor: number; total_commission_minor: number; downloadable: boolean }>(`/api/manage/${propertyCode}/statements/${ym}`);
      tableHost.replaceChildren();
      downloadHost.replaceChildren();
      if (!res.ok) {
        const p = document.createElement("p");
        p.textContent = res.status === 404 ? t("page.missing", { fmt: fmt() }) : t("page.forbidden", { fmt: fmt() });
        tableHost.appendChild(p);
        return;
      }
      const table = document.createElement("table");
      table.className = "data statement-table";
      table.setAttribute("aria-label", ui("statements.title"));
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      for (const key of ["statements.code", "statements.kind", "statements.base", "statements.commission"]) {
        const th = document.createElement("th");
        th.textContent = ui(key);
        if (key !== "statements.code" && key !== "statements.kind") th.className = "num";
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const line of res.data.lines) {
        const row = document.createElement("tr");
        const codeTd = document.createElement("td");
        codeTd.textContent = line.code;
        const kindTd = document.createElement("td");
        kindTd.textContent = ui(line.kind === "stay" ? "statements.stay" : "statements.cancellation");
        const baseTd = document.createElement("td");
        baseTd.className = "num";
        baseTd.textContent = moneyText(line.base_minor, "EUR");
        const commTd = document.createElement("td");
        commTd.className = "num";
        commTd.textContent = moneyText(line.commission_minor, "EUR");
        row.append(codeTd, kindTd, baseTd, commTd);
        tbody.appendChild(row);
      }
      const totalRow = document.createElement("tr");
      const labelTd = document.createElement("td");
      labelTd.textContent = ui("statements.total_row");
      const emptyTd = document.createElement("td");
      const totalBase = document.createElement("td");
      totalBase.className = "num";
      totalBase.textContent = moneyText(res.data.total_base_minor, "EUR");
      const totalComm = document.createElement("td");
      totalComm.className = "num";
      totalComm.textContent = moneyText(res.data.total_commission_minor, "EUR");
      totalRow.append(labelTd, emptyTd, totalBase, totalComm);
      tbody.appendChild(totalRow);
      table.appendChild(tbody);
      tableHost.appendChild(table);
      if (res.data.downloadable) {
        const link = document.createElement("a");
        link.href = `/api/manage/${propertyCode}/statements/${ym}.csv`;
        link.textContent = ui("statements.download");
        link.addEventListener("click", async (e) => {
          if (link.dataset.storageTried === "1") return;
          e.preventDefault();
          link.setAttribute("aria-busy", "true");
          const res2 = await fetch(link.href);
          link.removeAttribute("aria-busy");
          if (res2.status === 503) {
            outageBand(t("storage.doc", { fmt: fmt() }));
            return;
          }
          const blob = await res2.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${propertyCode}-${ym}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        });
        downloadHost.appendChild(link);
      }
    };
    monthSel.addEventListener("change", () => { void load(); });
    await load();
  }
};

export default page;
