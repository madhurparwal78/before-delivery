import { announce, el, qs } from "../core.js";
import { dialogs } from "../dialogs.js";
import { mintTile } from "./pieces.js";

type PreviewRow = { row: number; status: string; reason: string | null; client: string; piece: string; stamp: string };
type Counts = { new: number; matched: number; refused: number };

export async function installWorkbook(root: HTMLElement): Promise<void> {
  let preview: { rows: PreviewRow[]; counts: Counts } | null = null;
  let file: File | null = null;

  const render = (): void => {
    root.innerHTML = `<div class="bento workbook-grid">
      <div class="tile wide">
        <h2>Old workbook</h2>
        <button id="choose-file" class="file-button" aria-label="Choose a file">Choose a file</button>
        <input type="file" id="workbook-file" accept=".csv,text/csv" hidden>
        <p id="file-name">${file ? file.name : "No file chosen."}</p>
        <div id="preview-region" role="region" aria-label="Workbook preview">
          ${preview ? `<div class="table-frame" tabindex="0" role="region" aria-label="Workbook preview">
            <table><thead><tr><th>Row</th><th>Status</th><th>Client</th><th>Piece</th><th>Stamp</th></tr></thead>
            <tbody>${preview.rows.map((r) => `<tr class="${r.status}"><td>${r.row}</td><td>${r.status}</td><td>${r.client}</td><td>${r.piece}</td><td>${r.stamp}</td></tr>`).join("")}</tbody></table>
          </div>` : "<p>No preview yet.</p>"}
        </div>
        <a href="/api/materials-list.csv" id="materials-list">Download materials list</a>
      </div>
      ${mintTile(String(preview?.counts.new ?? 0), "new rows")}
    </div>`;
    const input = qs<HTMLInputElement>("#workbook-file", root)!;
    qs("#choose-file", root)!.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      file = input.files?.[0] ?? null;
      if (file) void runPreview(file);
    });
  };

  const runPreview = async (f: File): Promise<void> => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const form = new FormData();
    form.append("file", new Blob([bytes]), f.name);
    const res = await fetch("/api/workbook/preview", { method: "POST", body: form, credentials: "same-origin" });
    const data = await res.json() as { rows: PreviewRow[]; counts: Counts; error?: { message?: string } };
    if (!res.ok) {
      announce(data.error?.message ?? "This file could not be read.");
      return;
    }
    preview = { rows: data.rows, counts: data.counts };
    announce(`Preview ready: ${data.counts.new} new, ${data.counts.matched} matched, ${data.counts.refused} refused.`);
    render();
  };

  const bar = qs("#bottom-bar");
  if (bar) {
    bar.innerHTML = `<button class="primary" id="save-workbook">Save</button>`;
    qs("#save-workbook", bar)!.addEventListener("click", () => {
      if (!file) {
        announce("No file chosen.");
        return;
      }
      dialogs.openDialog("Save this file", "<p>Rows match on the stamp number; a matched row changes nothing.</p>", async () => {
        const bytes = new Uint8Array(await file!.arrayBuffer());
        const form = new FormData();
        form.append("file", new Blob([bytes]), file!.name);
        const res = await fetch("/api/workbook/save", { method: "POST", body: form, credentials: "same-origin" });
        const data = await res.json() as { created: number; matched: number; refused: number; error?: { message?: string } };
        if (!res.ok) {
          announce(data.error?.message ?? "This file could not be read.");
          return;
        }
        announce(`Saved: ${data.created} new, ${data.matched} matched, ${data.refused} refused.`);
        dialogs.closeDialog();
      });
    });
  }

  render();
}
