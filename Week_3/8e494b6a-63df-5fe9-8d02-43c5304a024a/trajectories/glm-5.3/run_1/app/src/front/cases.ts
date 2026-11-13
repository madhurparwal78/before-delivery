/**
 * Cases: the list, the case page with status controls and items.
 */
import { addLiveHandler, announce, api, ApiFail, displayIso, showNotice } from "./api";
import { emptyBand, namedAlert } from "./shell";
import { openModal } from "./modals";
import { h } from "./core";

export interface CaseSummary {
  number: number;
  title: string;
  status: string;
}

interface CaseItem {
  id: number;
  kind: string;
  ref: string;
}

function goTo(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export const CASE_STATUS_FLOW: Record<string, string[]> = {
  open: ["investigating"],
  investigating: ["resolved"],
  resolved: ["closed", "investigating"],
  closed: [],
};

export function buildCases(view: HTMLElement): void {
  const holder = h("div", {});
  const newCase = h("button", { class: "btn-main" }, "New case");
  newCase.addEventListener("click", () => {
    openModal(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "New case"));
        const title = document.createElement("input");
        title.className = "input";
        title.setAttribute("aria-label", "Case title");
        const create = h("button", { class: "btn-main" }, "Create case");
        const cancel = h("button", { class: "btn" }, "Cancel");
        cancel.addEventListener("click", close);
        create.addEventListener("click", async () => {
          create.setAttribute("aria-busy", "true");
          try {
            const res = await api<{ number: number }>("/api/cases", {
              method: "POST",
              body: JSON.stringify({ title: title.value }),
              headers: { "Content-Type": "application/json" },
            });
            showNotice(`Case ${res.number} created.`);
            announce(`Case ${res.number} is now open`);
            close();
            void load();
          } catch (err) {
            if (err instanceof ApiFail) showNotice(err.body.message);
          } finally {
            create.removeAttribute("aria-busy");
          }
        });
        const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
        row.append(create, cancel);
        box.append(title, row);
        return box;
      },
      newCase,
      "New case",
    );
  });

  async function load(): Promise<void> {
    try {
      const res = await api<{ cases: CaseSummary[] }>("/api/cases");
      const table = h("table", {});
      table.setAttribute("aria-label", "Cases");
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Number", "Title", "Status"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const c of res.cases) {
        const tr = h("tr", {});
        tr.setAttribute("aria-label", `Case ${c.number}: ${c.title}, ${c.status}`);
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => goTo(`/cases/${c.number}`));
        tr.append(h("td", { class: "mono" }, String(c.number)), h("td", {}, c.title), h("td", {}, c.status));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      holder.replaceChildren(table);
      if (res.cases.length === 0) {
        const btn = h("button", { class: "btn-main" }, "New case");
        btn.addEventListener("click", () => newCase.click());
        holder.append(emptyBand("No cases yet.", btn));
      }
    } catch {
      holder.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
    }
  }

  view.append(h("div", { style: { margin: "10px 0" } }, newCase), holder);
  addLiveHandler("case", () => void load());
  void load();
}

export function buildCasePage(view: HTMLElement, number: number): void {
  const wrap = h("div", {});
  const heading = h("h2", {});
  const statusHolder = h("div", {});
  const itemsHolder = h("div", {});
  const traceHolder = h("div", {});
  wrap.append(heading, statusHolder, itemsHolder, traceHolder);
  view.append(wrap);

  async function load(): Promise<void> {
    try {
      const res = await api<{ number: number; title: string; status: string; items: CaseItem[] }>(
        `/api/cases/${number}`,
      );
      heading.textContent = `Case ${res.number}: ${res.title}`;
      statusHolder.replaceChildren();
      const combo = h("select", { class: "input", "aria-label": "Case status" }) as HTMLSelectElement;
      for (const s of ["open", "investigating", "resolved", "closed"]) {
        combo.append(Object.assign(document.createElement("option"), { value: s, textContent: s }));
      }
      combo.value = res.status;
      const update = h("button", { class: "btn-main" }, "Update status");
      update.addEventListener("click", async () => {
        update.setAttribute("aria-busy", "true");
        try {
          await api(`/api/cases/${number}`, {
            method: "PATCH",
            body: JSON.stringify({ status: combo.value }),
            headers: { "Content-Type": "application/json" },
          });
          announce(`Case ${number} is now ${combo.value}`);
          void load();
        } catch (err) {
          if (err instanceof ApiFail) showNotice(err.body.message);
        } finally {
          update.removeAttribute("aria-busy");
        }
      });
      const row = h("div", { style: { display: "flex", gap: "8px" } });
      row.append(combo, update);
      statusHolder.append(row);

      itemsHolder.replaceChildren(h("h3", {}, "Case items"));
      const list = h("div", { role: "list", "aria-label": "Case items" });
      for (const item of res.items) {
        const li = h("div", { role: "listitem", class: "card" });
        if (item.kind === "trace") {
          const a = document.createElement("a");
          a.href = `/traces/${item.ref}`;
          a.textContent = `Trace ${item.ref}`;
          a.addEventListener("click", (e) => {
            e.preventDefault();
            goTo(`/traces/${item.ref}`);
          });
          li.append(a);
        } else if (item.kind === "inbox") {
          li.textContent = `Inbox item: ${item.ref}`;
        } else {
          li.textContent = item.ref;
        }
        list.append(li);
      }
      itemsHolder.append(list);

      traceHolder.replaceChildren();
      const traceLabel = h("label", {}, "Trace id");
      const traceInput = document.createElement("input");
      traceInput.className = "input mono";
      traceInput.setAttribute("aria-label", "Trace id");
      const link = h("button", { class: "btn" }, "Link trace");
      link.addEventListener("click", async () => {
        try {
          await api(`/api/cases/${number}/items`, {
            method: "POST",
            body: JSON.stringify({ trace_id: traceInput.value }),
            headers: { "Content-Type": "application/json" },
          });
          showNotice(`Added to case ${number}.`);
          void load();
        } catch (err) {
          if (err instanceof ApiFail) showNotice(err.body.message);
        }
      });
      const traceRow = h("div", { style: { display: "flex", gap: "8px", marginTop: "8px" } });
      traceRow.append(traceLabel, traceInput, link);
      traceHolder.append(traceRow);
    } catch {
      wrap.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
    }
  }

  addLiveHandler("case", () => void load());
  void load();
}
