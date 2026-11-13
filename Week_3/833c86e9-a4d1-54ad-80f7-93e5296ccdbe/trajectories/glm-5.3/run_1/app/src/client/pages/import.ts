import { t, fmt, moneyText } from "../i18n.js";
import { ui } from "../boot.js";
import { api } from "../api.js";
import { toast, outageBand, status } from "../ui.js";
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
    h1.textContent = ui("import.file");
    wrap.appendChild(h1);

    const fileLabel = document.createElement("label");
    const file = document.createElement("input");
    file.type = "file";
    file.setAttribute("aria-label", ui("import.file"));
    fileLabel.append(document.createTextNode(ui("import.file")), file);
    wrap.appendChild(fileLabel);

    const buttons = document.createElement("div");
    const previewBtn = document.createElement("button");
    previewBtn.textContent = ui("import.preview");
    const applyBtn = document.createElement("button");
    applyBtn.textContent = ui("import.apply");
    applyBtn.disabled = true;
    buttons.append(previewBtn, applyBtn);
    wrap.appendChild(buttons);

    const previewHost = document.createElement("div");
    wrap.appendChild(previewHost);

    let lastBytes: ArrayBuffer | null = null;
    let lastSha = "";

    previewBtn.addEventListener("click", async () => {
      const f = file.files?.[0];
      if (!f) return;
      previewBtn.setAttribute("aria-busy", "true");
      const bytes = await f.arrayBuffer();
      lastBytes = bytes;
      const res = await api<{ sha256: string; changes: { room: string; date: string; old_minor: number; new_minor: number }[]; count: number }>(`/api/manage/${propertyCode}/imports/preview`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: new Uint8Array(bytes)
      });
      previewBtn.removeAttribute("aria-busy");
      previewHost.replaceChildren();
      if (!res.ok) {
        applyBtn.disabled = true;
        if (res.data.error === "import_invalid") {
          const lines = res.data.lines as { line: number; key: string; params: Record<string, unknown> }[];
          const list = document.createElement("ul");
          list.setAttribute("role", "list");
          list.setAttribute("aria-label", ui("import.errors"));
          for (const l of lines) {
            const li = document.createElement("li");
            li.textContent = t(l.key as Parameters<typeof t>[0], { ...l.params, fmt: fmt() });
            list.appendChild(li);
          }
          previewHost.appendChild(list);
        } else if (res.data.error === "too_large") {
          const n = Number(res.data.n ?? 1000000);
          outageBand(t("import.too_large", { n, fmt: fmt() }));
        }
        return;
      }
      lastSha = res.data.sha256;
      const countP = document.createElement("p");
      countP.setAttribute("role", "status");
      countP.textContent = t("import.count", { count_noun: "night", n: res.data.count, fmt: fmt() });
      previewHost.appendChild(countP);
      const table = document.createElement("table");
      table.className = "data";
      table.setAttribute("aria-label", ui("import.preview_table"));
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      for (const key of ["reservations.code", "reservations.arrival", "statements.base"]) {
        const th = document.createElement("th");
        th.textContent = ui(key);
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const ch of res.data.changes) {
        const row = document.createElement("tr");
        const roomTd = document.createElement("td");
        roomTd.textContent = ch.room;
        const dateTd = document.createElement("td");
        dateTd.textContent = ch.date;
        const diffTd = document.createElement("td");
        diffTd.textContent = `${moneyText(ch.old_minor, "EUR")} → ${moneyText(ch.new_minor, "EUR")}`;
        row.append(roomTd, dateTd, diffTd);
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
      previewHost.appendChild(table);
      applyBtn.disabled = false;
    });

    applyBtn.addEventListener("click", async () => {
      if (!lastBytes) return;
      applyBtn.setAttribute("aria-busy", "true");
      const res = await api<{ sha256: string; count: number }>(`/api/manage/${propertyCode}/imports`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: new Uint8Array(lastBytes)
      });
      applyBtn.removeAttribute("aria-busy");
      if (!res.ok) {
        if (res.data.error === "storage_unavailable") {
          outageBand(t("storage.import", { fmt: fmt() }));
          // the preview stays and Apply retries
        }
        return;
      }
      toast(t("toast.imported", { fmt: fmt() }));
      applyBtn.disabled = true;
    });
  }
};

export default page;
