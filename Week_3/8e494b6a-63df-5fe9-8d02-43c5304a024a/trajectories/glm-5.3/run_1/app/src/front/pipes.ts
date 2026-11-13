/**
 * The Pipes page: Spoor Pipe input, run button and the typed result table.
 */
import { api, ApiFail, showNotice } from "./api";
import { h } from "./core";

export function buildPipes(view: HTMLElement): void {
  const wrap = h("div", {});
  const input = document.createElement("textarea");
  input.className = "input mono";
  input.setAttribute("aria-label", "Spoor Pipe");
  input.rows = 3;
  input.value = "FROM web";
  input.style.width = "100%";
  const run = h("button", { class: "btn-main" }, "Run");
  const error = h("div", {});
  const table = h("table", {});
  table.setAttribute("aria-label", "Result");
  const bar = h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", marginBottom: "8px" } });
  bar.append(run);
  wrap.append(input, bar, error, table);
  view.append(wrap);

  async function runPipe(): Promise<void> {
    error.replaceChildren();
    try {
      const res = await api<{ columns: { name: string; type: string }[]; rows: unknown[][] }>("/api/pipe", {
        method: "POST",
        body: JSON.stringify({ pipe: input.value }),
        headers: { "Content-Type": "application/json" },
      });
      table.replaceChildren();
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of res.columns) {
        const th = h("th", {}, c.name);
        th.setAttribute("data-type", c.type);
        headRow.append(th);
      }
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const row of res.rows) {
        const tr = h("tr", {});
        for (const cell of row) {
          const v = cell instanceof Date ? cell.toISOString() : cell === null ? "null" : String(cell);
          tr.append(h("td", { class: "mono" }, v));
        }
        tbody.append(tr);
      }
      table.append(thead, tbody);
    } catch (err) {
      table.replaceChildren();
      if (err instanceof ApiFail) {
        const alert = h("div", { class: "error-box", role: "alert" });
        alert.setAttribute("aria-label", "Pipe error");
        alert.textContent = err.body.message;
        error.append(alert);
      }
    }
  }

  run.addEventListener("click", () => void runPipe());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void runPipe();
    }
  });
  void runPipe();
}
