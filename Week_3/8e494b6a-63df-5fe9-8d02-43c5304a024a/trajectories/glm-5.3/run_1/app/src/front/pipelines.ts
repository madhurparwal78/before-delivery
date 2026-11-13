/**
 * Pipelines list, the editor and the simulate page (rule C).
 */
import { api, ApiFail, showNotice } from "./api";
import { emptyBand, namedAlert } from "./shell";
import { openModal } from "./modals";
import { h } from "./core";

interface StepInfo {
  step: number;
  processor: string;
  status: "applied" | "skipped" | "failed" | "dropped";
  event: Record<string, unknown>;
  changed: string[];
  text?: string;
}

interface SimResult {
  event: number;
  outcome: "stored" | "dropped" | "failed";
  error?: string;
  steps: StepInfo[];
}

function goTo(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function buildPipelines(view: HTMLElement): void {
  const holder = h("div", {});
  const newPipeline = h("button", { class: "btn-main" }, "New pipeline");
  const load = async (): Promise<void> => {
    try {
      const res = await api<{ pipelines: { name: string; version: number; processors: unknown[] }[] }>("/api/pipelines");
      const table = h("table", {});
      table.setAttribute("aria-label", "Pipelines");
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Name", "Version", "Processors"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const p of res.pipelines) {
        const tr = h("tr", {});
        const a = document.createElement("a");
        a.href = `/pipelines/${p.name}`;
        a.textContent = p.name;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          goTo(`/pipelines/${p.name}`);
        });
        const td = h("td", {});
        td.append(a);
        tr.append(td, h("td", { class: "mono" }, String(p.version)), h("td", { class: "mono" }, String(p.processors.length)));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      holder.replaceChildren(table);
      if (res.pipelines.length === 0) {
        holder.append(emptyBand("No pipelines yet.", h("button", { class: "btn-main" }, "New pipeline")));
      }
    } catch {
      holder.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
    }
  };
  newPipeline.addEventListener("click", () => {
    openModal(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "New pipeline"));
        const name = document.createElement("input");
        name.className = "input mono";
        name.setAttribute("aria-label", "Pipeline name");
        const create = h("button", { class: "btn-main" }, "Create pipeline");
        const cancel = h("button", { class: "btn" }, "Cancel");
        cancel.addEventListener("click", close);
        create.addEventListener("click", async () => {
          create.setAttribute("aria-busy", "true");
          try {
            await api(`/api/pipelines/${encodeURIComponent(name.value)}`, {
              method: "PUT",
              body: JSON.stringify({ processors: [] }),
              headers: { "Content-Type": "application/json" },
            });
            close();
            goTo(`/pipelines/${name.value}`);
          } catch (err) {
            if (err instanceof ApiFail) showNotice(err.body.message);
          } finally {
            create.removeAttribute("aria-busy");
          }
        });
        const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
        row.append(create, cancel);
        box.append(name, row);
        return box;
      },
      newPipeline,
      "New pipeline",
    );
  });
  view.append(h("div", { style: { marginTop: "10px", marginBottom: "10px" } }, newPipeline), holder);
  void load();
}

export function buildPipelineEditor(view: HTMLElement, name: string): void {
  const wrap = h("div", { class: "card" });
  wrap.style.maxWidth = "860px";
  const heading = h("h2", {}, `Pipeline ${name}`);
  const versionText = h("div", { class: "mono muted" });
  const textarea = document.createElement("textarea");
  textarea.className = "input mono";
  textarea.setAttribute("aria-label", "Processors JSON");
  textarea.rows = 12;
  const save = h("button", { class: "btn-main" }, "Save pipeline");
  const simLink = document.createElement("a");
  simLink.href = `/pipelines/${name}/simulate`;
  simLink.textContent = "Simulate";
  simLink.addEventListener("click", (e) => {
    e.preventDefault();
    goTo(`/pipelines/${name}/simulate`);
  });
  const error = h("div", {});

  save.addEventListener("click", async () => {
    save.setAttribute("aria-busy", "true");
    error.replaceChildren();
    try {
      const processors = JSON.parse(textarea.value);
      const res = await api<{ name: string; version: number; message: string }>(
        `/api/pipelines/${encodeURIComponent(name)}`,
        {
          method: "PUT",
          body: JSON.stringify({ processors }),
          headers: { "Content-Type": "application/json" },
        },
      );
      versionText.textContent = `Version ${res.version}`;
      showNotice(res.message);
    } catch (err) {
      if (err instanceof ApiFail) {
        const alert = h("div", { class: "error-box", role: "alert" });
        alert.setAttribute("aria-label", "Error");
        const lines: string[] = [err.body.message];
        if (err.body.fields) {
          for (const v of Object.values(err.body.fields)) lines.push(String(v));
        }
        alert.textContent = lines.join(" ");
        error.append(alert);
      }
    } finally {
      save.removeAttribute("aria-busy");
    }
  });

  const bar = h("div", { style: { display: "flex", gap: "10px", marginTop: "8px" } });
  bar.append(save, simLink);
  wrap.append(heading, versionText, textarea, error, bar);
  view.append(wrap);

  void (async () => {
    try {
      const res = await api<{ name: string; version: number; processors: unknown[] }>(
        `/api/pipelines/${encodeURIComponent(name)}`,
      ).catch(async () => {
        const all = await api<{ pipelines: { name: string; version: number; processors: unknown[] }[] }>("/api/pipelines");
        const found = all.pipelines.find((p) => p.name === name);
        return found ?? { name, version: 1, processors: [] };
      });
      textarea.value = JSON.stringify(res.processors, null, 2);
      versionText.textContent = `Version ${res.version}`;
    } catch {
      textarea.value = "[]";
    }
  })();
}

export function buildSimulate(view: HTMLElement, name: string): void {
  const wrap = h("div", {});
  const region = h("div", { role: "region", "aria-label": "Simulate", class: "card" });
  const sample = document.createElement("textarea");
  sample.className = "input mono";
  sample.setAttribute("aria-label", "Sample events");
  sample.rows = 5;
  sample.value = JSON.stringify({ "@timestamp": "2026-03-01T00:00:00.000Z", message: "from 10.0.0.1 ok", host: "host-7" });
  const run = h("button", { class: "btn-main" }, "Run simulation");
  const results = h("div", {});
  region.append(h("h2", {}, "Simulate"), sample, run, results);
  wrap.append(region);
  view.append(wrap);

  run.addEventListener("click", () => void runSim());

  async function runSim(): Promise<void> {
    results.replaceChildren();
    try {
      const res = await api<{ results: SimResult[] }>(`/api/pipelines/${encodeURIComponent(name)}/simulate`, {
        method: "POST",
        body: JSON.stringify({ lines: sample.value }),
        headers: { "Content-Type": "application/json" },
      });
      for (const r of res.results) {
        const group = h("div", { role: "group", "aria-label": `Event ${r.event}`, class: "card" });
        const head = h("div", { class: "mono" }, `Event ${r.event}: ${r.outcome}`);
        head.style.fontWeight = "600";
        group.append(head);
        if (r.error) {
          group.append(Object.assign(document.createElement("div"), { textContent: r.error, className: "error-box" }));
        }
        for (const s of r.steps) {
          const step = h("div", { role: "group", "aria-label": `Step ${s.step} ${s.processor}`, class: "card" });
          step.style.marginLeft = "12px";
          const line = h("div", { class: "mono" });
          line.textContent = s.text ?? `Step ${s.step} ${s.processor}: ${s.status}`;
          step.append(line);
          const pre = Object.assign(document.createElement("pre"), {
            textContent: JSON.stringify(s.event, null, 2),
            className: "mono",
          });
          pre.style.fontSize = "12px";
          pre.style.whiteSpace = "pre-wrap";
          step.append(pre);
          if (s.changed.length > 0) {
            const changedNote = h("div", { class: "mono" }, `changed: ${s.changed.join(", ")}`);
            for (const field of s.changed) {
              // mark each changed field in the JSON view
            }
            step.append(changedNote);
          }
          group.append(step);
        }
        results.append(group);
      }
    } catch (err) {
      if (err instanceof ApiFail) {
        const alert = h("div", { class: "error-box", role: "alert" });
        alert.setAttribute("aria-label", "Error");
        alert.textContent = err.body.message;
        results.append(alert);
      }
    }
  }
}
