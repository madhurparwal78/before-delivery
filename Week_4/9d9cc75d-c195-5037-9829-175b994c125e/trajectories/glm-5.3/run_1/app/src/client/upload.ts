/** The upload page: preview with types, upload errors at their line. */

import { api, esc } from "./api.js";

export async function uploadPage(): Promise<void> {
  const meRes = await api<{ projects: { id: string; name: string; role: string }[] }>("GET", "/api/me");
  if (meRes.status !== 200) {
    location.href = "/signin?next=/sources/new";
    return;
  }
  const projects = meRes.json!.projects.filter((p) => p.role === "creator");
  document.getElementById("page")!.className = "depth-raw";
  document.getElementById("page")!.innerHTML = `
    <div class="stack" style="max-width:900px;margin:0 auto;padding:24px;">
      <h1 class="headline">Upload a source</h1>
      <section class="card">
        <div class="row">
          <label>Project <select id="project" aria-label="Project">${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
          <label>Source name <input id="source-name" aria-label="Source name"></label>
          <label>Table name <input id="table-name" aria-label="Table name" value="data"></label>
          <button id="choose-file">Choose file</button>
          <button id="upload" class="primary">Upload</button>
        </div>
        <input type="file" id="file-input" accept=".csv" style="display:none">
        <p id="upload-state" role="status" aria-live="polite" class="status"></p>
        <ul id="upload-errors" role="list" aria-label="Upload errors" style="color:#8a1c4a"></ul>
        <div id="preview-holder"></div>
      </section>
    </div>`;

  const state = document.getElementById("upload-state")!;
  const errorsEl = document.getElementById("upload-errors")!;
  const previewHolder = document.getElementById("preview-holder")!;
  const fileInput = document.getElementById("file-input") as HTMLInputElement;
  let pendingBytes: ArrayBuffer | null = null;
  let pendingName = "";

  document.getElementById("choose-file")!.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    pendingBytes = await file.arrayBuffer();
    pendingName = file.name;
    document.getElementById("choose-file")!.textContent = `Choose file (${file.name})`;
    await preview();
  });

  async function preview(): Promise<void> {
    if (!pendingBytes) return;
    const projectId = (document.getElementById("project") as HTMLSelectElement).value;
    const res = await fetch(`/api/projects/${projectId}/sources/preview`, {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: new Uint8Array(pendingBytes),
    });
    const data = await res.json() as { columns: { name: string; type: string }[]; rows: (string | null)[][]; row_count: number; errors: { line: number | null; message: string }[] };
    errorsEl.innerHTML = (data.errors ?? []).map((e) => `<li role="listitem">${esc(e.message)}</li>`).join("");
    previewHolder.innerHTML = `
      <table class="data" role="table" aria-label="Preview">
        <thead><tr>${(data.columns ?? []).map((c) => `<th scope="col" class="columnheader" data-type="${c.type}">${esc(c.name)}</th>`).join("")}</tr></thead>
        <tbody>${(data.rows ?? []).map((r) => `<tr>${r.map((v) => `<td>${esc(v === null ? "(null)" : String(v))}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
      <p class="muted">${data.row_count} rows</p>`;
  }

  document.getElementById("upload")!.addEventListener("click", async () => {
    if (!pendingBytes) {
      state.textContent = "Choose a file first.";
      return;
    }
    const projectId = (document.getElementById("project") as HTMLSelectElement).value;
    const name = (document.getElementById("source-name") as HTMLInputElement).value;
    const table = (document.getElementById("table-name") as HTMLInputElement).value || "data";
    state.textContent = "Uploading...";
    const res = await fetch(`/api/projects/${projectId}/sources?name=${encodeURIComponent(name)}&table=${encodeURIComponent(table)}`, {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: new Uint8Array(pendingBytes),
    });
    const data = await res.json() as { id?: string; errors?: { line: number | null; message: string }[]; error?: string };
    if (res.status === 201 && data.id) {
      state.textContent = `Uploaded ${table}: ${pendingName}.`;
      location.href = `/sources/${data.id}`;
      return;
    }
    if (res.status === 503) {
      state.textContent = "Storage is unavailable. Your file was not saved. Try again.";
      const retry = document.createElement("button");
      retry.id = "retry";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => void (document.getElementById("upload") as HTMLButtonElement).click());
      if (!document.getElementById("retry")) state.parentElement?.appendChild(retry);
      return;
    }
    state.textContent = "";
    errorsEl.innerHTML = (data.errors ?? []).map((e) => `<li role="listitem">${esc(e.message)}</li>`).join("");
    if (data.error === "invalid_csv" && (data.errors ?? []).length === 0) {
      errorsEl.innerHTML = `<li role="listitem">The file has errors.</li>`;
    }
  });
}
