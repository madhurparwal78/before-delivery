/**
 * Streams list, one stream page (mapping, upload, failure store), analyze and lifecycle pages.
 */
import { addLiveHandler, api, ApiFail, displayIso, serverNow, showNotice } from "./api";
import { currentRoute, emptyBand, namedAlert } from "./shell";
import { openModal } from "./modals";
import { effect, h } from "./core";
import type { GenerationInfo } from "../shared/types";
import { formatInZone } from "../shared/tz";

interface StreamSummary {
  name: string;
  write_generation: number;
  events: number;
  failures: number;
}

function goTo(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function buildStreams(view: HTMLElement): void {
  const holder = h("div", {});
  view.append(holder);
  const load = async (): Promise<void> => {
    try {
      const res = await api<{ streams: StreamSummary[] }>("/api/streams");
      const table = h("table", {});
      table.setAttribute("aria-label", "Streams");
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Name", "Write generation", "Events", "Failures"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const s of res.streams) {
        const tr = h("tr", {});
        const a = document.createElement("a");
        a.href = `/streams/${s.name}`;
        a.textContent = s.name;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          goTo(`/streams/${s.name}`);
        });
        const td = h("td", {});
        td.append(a);
        tr.append(td, h("td", { class: "mono" }, String(s.write_generation)), h("td", { class: "mono" }, String(s.events)), h("td", { class: "mono" }, String(s.failures)));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      holder.replaceChildren(table);
      if (res.streams.length === 0) {
        const btn = h("button", { class: "btn-main" }, "New stream");
        btn.addEventListener("click", () => newStreamDialog(load));
        holder.append(emptyBand("No streams in this space yet.", btn));
      }
    } catch {
      holder.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
    }
  };
  const newStream = h("button", { class: "btn-main" }, "New stream");
  newStream.addEventListener("click", () => newStreamDialog(load));
  const bar = h("div", { style: { marginTop: "10px" } });
  bar.append(newStream);
  view.prepend(bar);
  void load();
}

function newStreamDialog(after: () => void): void {
  openModal(
    (close) => {
      const box = h("div", {});
      box.append(h("h3", {}, "New stream"));
      const name = document.createElement("input");
      name.className = "input mono";
      name.setAttribute("aria-label", "Stream name");
      const create = h("button", { class: "btn-main" }, "Create stream");
      const cancel = h("button", { class: "btn" }, "Cancel");
      cancel.addEventListener("click", close);
      create.addEventListener("click", async () => {
        create.setAttribute("aria-busy", "true");
        try {
          await api("/api/streams", {
            method: "POST",
            body: JSON.stringify({ name: name.value }),
            headers: { "Content-Type": "application/json" },
          });
          showNotice(`Stream ${name.value} created.`);
          close();
          after();
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
    null,
    "New stream",
  );
}

interface UploadInfo {
  id: string;
  file: string;
  bytes: number;
  sha256: string;
  status: string;
  done_lines: number;
  total_lines: number;
  created: number;
  duplicates: number;
  dropped: number;
  failed: number;
}

interface FailureInfo {
  id: number;
  reason: string;
  raw: string;
  at: string;
}

interface MappingEntry {
  field: string;
  type: string;
  generation: number;
  explicit: boolean;
}

export function buildStreamPage(view: HTMLElement, stream: string): void {
  const wrap = h("div", {});
  view.append(wrap);
  const upper = h("div", { style: { display: "flex", gap: "14px", flexWrap: "wrap" } });
  const mappingCard = h("div", { class: "card" });
  mappingCard.style.flex = "1";
  mappingCard.style.minWidth = "320px";
  const uploadCard = h("div", { class: "card" });
  uploadCard.style.flex = "1";
  uploadCard.style.minWidth = "320px";
  upper.append(mappingCard, uploadCard);
  const failureRegion = h("div", { role: "region", "aria-label": "Failure store" });
  const links = h("div", { style: { marginBottom: "8px" } });
  const analyzeLink = document.createElement("a");
  analyzeLink.href = `/streams/${stream}/analyze`;
  analyzeLink.textContent = "Analyze";
  analyzeLink.addEventListener("click", (e) => {
    e.preventDefault();
    goTo(`/streams/${stream}/analyze`);
  });
  const lifecycleLink = document.createElement("a");
  lifecycleLink.href = `/streams/${stream}/lifecycle`;
  lifecycleLink.textContent = "Lifecycle";
  lifecycleLink.addEventListener("click", (e) => {
    e.preventDefault();
    goTo(`/streams/${stream}/lifecycle`);
  });
  links.append(analyzeLink, document.createTextNode(" · "), lifecycleLink);
  wrap.append(links, upper, failureRegion);

  // Mapping
  const mappingTable = h("table", {});
  mappingTable.setAttribute("aria-label", "Mapping");
  const addField = h("button", { class: "btn" }, "Add field");

  // Upload controls
  const pipelineCombo = h("select", { class: "input mono", "aria-label": "Pipeline" }) as HTMLSelectElement;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void uploadFile(file);
  });
  const uploadBtn = h("button", { class: "btn-main" }, "Upload file");
  uploadBtn.addEventListener("click", () => fileInput.click());
  const progress = h("div", { role: "progressbar", "aria-label": "Upload progress", class: "mono" });
  const progressText = h("span", { class: "mono muted" });
  const uploadError = h("div", {});
  const uploadsTable = h("table", {});
  uploadsTable.setAttribute("aria-label", "Uploads");

  uploadCard.append(
    h("h3", {}, "Upload"),
    pipelineCombo,
    uploadBtn,
    fileInput,
    progress,
    progressText,
    uploadError,
    uploadsTable,
  );
  mappingCard.append(h("h3", {}, "Mapping"), mappingTable, addField);

  async function uploadFile(file: File): Promise<void> {
    const fd = new FormData();
    fd.append("file", file);
    const pipeline = pipelineCombo.value;
    if (pipeline && pipeline !== "None") fd.append("pipeline", pipeline);
    uploadError.replaceChildren();
    try {
      const res = await api<{ id: string; file: string; bytes: number; status: string }>(
        `/api/streams/${encodeURIComponent(stream)}/uploads`,
        { method: "POST", body: fd },
      );
      void loadUploads();
    } catch (err) {
      if (err instanceof ApiFail) {
        uploadError.append(namedAlert("Error", err.body.message));
      }
    }
  }

  async function loadMapping(): Promise<void> {
    try {
      const res = await api<{ name: string; mapping: MappingEntry[]; generations: GenerationInfo[] }>(
        `/api/streams/${encodeURIComponent(stream)}`,
      );
      mappingTable.replaceChildren();
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Field", "Type", "Generation", "Explicit"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const m of res.mapping) {
        tbody.append(
          h(
            "tr",
            {},
            h("td", { class: "mono" }, m.field),
            h("td", { class: "mono" }, m.type),
            h("td", { class: "mono" }, String(m.generation)),
            h("td", {}, m.explicit ? "explicit" : "inferred"),
          ),
        );
      }
      mappingTable.append(thead, tbody);
    } catch (err) {
      if (err instanceof ApiFail) {
        mappingTable.replaceChildren();
      }
    }
  }

  addField.addEventListener("click", () => {
    openModal(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "Add field"));
        const field = document.createElement("input");
        field.className = "input mono";
        field.setAttribute("aria-label", "Field name");
        const type = h("select", { class: "input", "aria-label": "Field type" }) as HTMLSelectElement;
        for (const t of ["number", "date", "boolean", "text", "keyword"]) {
          type.append(Object.assign(document.createElement("option"), { value: t, textContent: t }));
        }
        const add = h("button", { class: "btn-main" }, "Add");
        const cancel = h("button", { class: "btn" }, "Cancel");
        cancel.addEventListener("click", close);
        add.addEventListener("click", async () => {
          add.setAttribute("aria-busy", "true");
          try {
            await api(`/api/streams/${encodeURIComponent(stream)}/mappings`, {
              method: "POST",
              body: JSON.stringify({ field: field.value, type: type.value }),
              headers: { "Content-Type": "application/json" },
            });
            showNotice(`Field ${field.value} added as ${type.value}.`);
            close();
            void loadMapping();
          } catch (err) {
            if (err instanceof ApiFail) showNotice(err.body.message);
          } finally {
            add.removeAttribute("aria-busy");
          }
        });
        const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
        row.append(add, cancel);
        box.append(field, type, row);
        return box;
      },
      addField,
      "Add field",
    );
  });

  async function loadPipelines(): Promise<void> {
    try {
      const res = await api<{ pipelines: { name: string }[] }>("/api/pipelines");
      pipelineCombo.replaceChildren(
        Object.assign(document.createElement("option"), { value: "None", textContent: "None" }),
      );
      for (const p of res.pipelines) {
        pipelineCombo.append(Object.assign(document.createElement("option"), { value: p.name, textContent: p.name }));
      }
    } catch {
      pipelineCombo.replaceChildren(
        Object.assign(document.createElement("option"), { value: "None", textContent: "None" }),
      );
    }
  }

  async function loadUploads(): Promise<void> {
    try {
      const res = await api<{ uploads: UploadInfo[] }>(`/api/streams/${encodeURIComponent(stream)}/uploads`);
      uploadsTable.replaceChildren();
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["File", "Bytes", "Status"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const u of res.uploads) {
        tbody.append(
          h("tr", {}, h("td", { class: "mono" }, u.file), h("td", { class: "mono" }, String(u.bytes)), h("td", {}, u.status)),
        );
      }
      uploadsTable.append(thead, tbody);
    } catch {
      uploadsTable.replaceChildren();
    }
  }

  async function loadFailures(): Promise<void> {
    try {
      const res = await api<{ failures: FailureInfo[] }>(`/api/streams/${encodeURIComponent(stream)}/failures`);
      failureRegion.replaceChildren();
      for (const f of res.failures) {
        const article = h("article", { class: "card mono" });
        article.style.fontSize = "12px";
        article.append(
          Object.assign(document.createElement("div"), { textContent: f.reason }),
          Object.assign(document.createElement("pre"), { textContent: f.raw }),
        );
        failureRegion.append(article);
      }
    } catch {
      failureRegion.replaceChildren();
    }
  }

  // live upload progress
  addLiveHandler("upload", (data) => {
    if (data.total_lines !== undefined && data.done_lines !== undefined) {
      const done = Number(data.done_lines);
      const totalLines = Number(data.total_lines);
      progress.setAttribute("aria-valuenow", String(done));
      progress.setAttribute("aria-valuemax", String(totalLines));
      progressText.textContent = `Upload: ${done} of ${totalLines} lines`;
      void loadUploads();
    }
    if (data.ended) {
      const created = Number(data.created ?? 0);
      const duplicates = Number(data.duplicates ?? 0);
      const failed = Number(data.failed ?? 0);
      const dropped = Number(data.dropped ?? 0);
      let msg = `Upload done: ${created} created, ${duplicates} ${duplicates === 1 ? "duplicate" : "duplicates"}, ${failed} failed`;
      if (dropped > 0) msg += `, ${dropped} dropped`;
      showNotice(msg);
      progressText.textContent = "";
      void loadUploads();
      void loadFailures();
    }
  });

  void loadMapping();
  void loadPipelines();
  void loadUploads();
  void loadFailures();
}

/** The analyze page: text analysis with the three published analyzers. */
export function buildAnalyzePage(view: HTMLElement, stream: string): void {
  const wrap = h("div", { class: "card" });
  wrap.style.maxWidth = "720px";
  const text = document.createElement("input");
  text.className = "input mono";
  text.setAttribute("aria-label", "Text");
  text.value = "The servers failed, retrying 2 connections";
  const analyzer = h("select", { class: "input", "aria-label": "Analyzer" }) as HTMLSelectElement;
  for (const a of ["standard", "keyword", "whitespace"]) {
    analyzer.append(Object.assign(document.createElement("option"), { value: a, textContent: a }));
  }
  const run = h("button", { class: "btn-main" }, "Analyze");
  const result = h("table", {});
  result.setAttribute("aria-label", "Tokens");
  wrap.append(h("h2", {}, "Analyze"), text, analyzer, run, result);
  view.append(wrap);

  async function runAnalyze(): Promise<void> {
    try {
      const res = await api<{ tokens: { token: string; position: number; start: number; end: number }[] }>("/api/analyze", {
        method: "POST",
        body: JSON.stringify({ analyzer: analyzer.value, text: text.value }),
        headers: { "Content-Type": "application/json" },
      });
      result.replaceChildren();
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Token", "Position", "Start", "End"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const t of res.tokens) {
        tbody.append(
          h("tr", {}, h("td", { class: "mono" }, t.token), h("td", { class: "mono" }, String(t.position)), h("td", { class: "mono" }, String(t.start)), h("td", { class: "mono" }, String(t.end))),
        );
      }
      result.append(thead, tbody);
    } catch {
      result.replaceChildren();
    }
  }
  run.addEventListener("click", () => void runAnalyze());
  void runAnalyze();
}
