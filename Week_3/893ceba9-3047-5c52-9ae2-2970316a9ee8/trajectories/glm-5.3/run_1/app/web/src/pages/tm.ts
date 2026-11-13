import { PageCtx } from "../main";
import { h, clearEl } from "../ui";
import { api, ProjectDetail, TmEntry, TmImport, ImportReport, hhmm } from "../api";
import { emptyIllustration } from "../illustrations";

export async function renderTmPage(ctx: PageCtx, slug: string): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  window.__deskCurrentSlug = slug;
  const detail = await api<ProjectDetail>(`/api/projects/${slug}`);
  const lang = new URLSearchParams(location.search).get("lang") || detail.target_languages[0];
  window.__deskCurrentLang = lang;

  const container = h("div", { class: "container", style: "padding-bottom:60px" });
  container.appendChild(h("div", { class: "page-head" },
    h("div", null, h("h1", {}, "Translation memory"),
      h("p", { class: "sub" }, `${detail.name} · exact matches fill untranslated segments`)),
    h("a", { class: "btn btn-outline btn-sm", href: `/projects/${slug}` }, "Back to project"),
  ));

  // import form
  const formCard = h("div", { class: "card", style: "margin-top:20px" });
  const form = h("form", { "aria-label": "Import translation memory" }) as HTMLFormElement;
  const file = h("input", { class: "control", type: "file", "aria-label": "Import file" }) as HTMLInputElement;
  const format = h("select", { class: "control", "aria-label": "Format", style: "max-width:160px" }) as HTMLSelectElement;
  format.appendChild(h("option", { value: "tmx" }, "TMX"));
  format.appendChild(h("option", { value: "csv" }, "CSV"));
  const importBtn = h("button", { class: "btn btn-primary", type: "submit" }, "Import");
  form.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Import file"), file));
  const fmtRow = h("div", { class: "row" }, format, importBtn);
  form.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Format"), fmtRow));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!file.files || !file.files[0]) { ctx.fb.setProblem("Choose a TMX or CSV file first."); return; }
    importBtn.disabled = true;
    ctx.fb.setStatus("Importing translation memory.");
    const fd = new FormData();
    fd.append("file", file.files[0]);
    fd.append("format", format.value);
    try {
      const res = await api<ImportReport>(`/api/projects/${slug}/tm/imports`, { method: "POST", body: fd });
      ctx.fb.setStatus(`Imported ${res.added} new entries, merged ${res.duplicates} duplicates and reused ${res.applied} exact matches.` + (res.rows.length ? ` ${res.rows.length} rows need attention.` : ""));
      await loadReport(res);
      await loadImports();
    } catch (e: any) {
      ctx.fb.clearStatus();
      const msg = e.fields && e.fields.file ? e.fields.file : e.message;
      ctx.fb.setProblem(msg);
    } finally { importBtn.disabled = false; }
  });
  formCard.appendChild(form);
  container.appendChild(formCard);

  // report region
  const reportRegion = h("section", { role: "region", "aria-label": "Import report", style: "margin-top:26px" });
  container.appendChild(reportRegion);

  // imports list
  const importsCard = h("div", { class: "card", style: "margin-top:26px" });
  importsCard.appendChild(h("h3", { style: "font-size:1.15em" }, "Imports"));
  const importsList = h("div");
  importsCard.appendChild(importsList);
  container.appendChild(importsCard);

  // search + entries
  const entriesCard = h("div", { class: "card", style: "margin-top:26px" });
  const search = h("input", { class: "control", type: "search", "aria-label": "Search translation memory", placeholder: "Search source text", style: "max-width:420px" }) as HTMLInputElement;
  const entriesTable = h("div");
  entriesCard.appendChild(h("h3", { style: "font-size:1.15em" }, "Entries"));
  entriesCard.appendChild(search);
  entriesCard.appendChild(h("div", { class: "mt-16" }, entriesTable));
  container.appendChild(entriesCard);

  main.appendChild(container);

  let lastReport: ImportReport | null = null;

  async function loadReport(res: ImportReport): Promise<void> {
    lastReport = res;
    clearEl(reportRegion);
    reportRegion.appendChild(h("p", { class: "muted" },
      `Imported ${res.added} new entries, merged ${res.duplicates} duplicates and reused ${res.applied} exact matches.` + (res.rows.length ? ` ${res.rows.length} rows need attention.` : "")));
    const table = h("table", { class: "plain" });
    table.appendChild(h("thead", null, h("tr", null, h("th", null, "Line"), h("th", null, "Reason"))));
    const tbody = h("tbody");
    for (const r of res.rows) tbody.appendChild(h("tr", null, h("td", { class: "num" }, String(r.line)), h("td", {}, r.reason)));
    table.appendChild(tbody);
    const wrap = h("div", { class: "table-wrap" });
    wrap.appendChild(table);
    reportRegion.appendChild(wrap);
    void lastReport;
  }

  async function loadImports(): Promise<void> {
    clearEl(importsList);
    try {
      const res = await api<{ imports: TmImport[] }>(`/api/projects/${slug}/tm/imports`);
      if (res.imports.length === 0) {
        importsList.appendChild(h("p", { class: "muted" }, "No imports yet."));
        return;
      }
      const table = h("table", { class: "plain" });
      table.appendChild(h("thead", null, h("tr", null, h("th", null, "File"), h("th", null, "Format"), h("th", null, "Size"), h("th", null, "Imported"), h("th", null, ""))));
      const tbody = h("tbody");
      for (const imp of res.imports) {
        const dl = h("a", { href: `/api/projects/${slug}/tm/imports/${imp.import_id}/original`, "data-download": "", download: imp.filename }, "Download original");
        const restore = h("button", { class: "btn btn-outline btn-sm", onclick: async () => {
          restore.disabled = true;
          ctx.fb.setStatus("Restoring.");
          try {
            await api(`/api/projects/${slug}/operations/${imp.import_id}/restore`, { method: "POST", json: {} });
            ctx.fb.setStatus("Restored the state before this import.");
            window.dispatchEvent(new PopStateEvent("popstate"));
          } catch (e: any) {
            restore.disabled = false;
            ctx.fb.clearStatus();
            ctx.fb.setProblem(e.message);
          }
        } }, "Restore");
        tbody.appendChild(h("tr", { class: "tm-entry" },
          h("td", null, imp.filename),
          h("td", null, imp.format.toUpperCase()),
          h("td", { class: "num" }, String(imp.size)),
          h("td", null, new Date(imp.at).toLocaleString()),
          h("td", null, dl, " ", restore),
        ));
      }
      table.appendChild(tbody);
      const wrap = h("div", { class: "table-wrap" });
      wrap.appendChild(table);
      importsList.appendChild(wrap);
    } catch (e: any) {
      importsList.appendChild(h("p", { class: "muted" }, "The desk couldn't reach the server. Check your connection and try again."));
    }
  }

  async function loadEntries(): Promise<void> {
    clearEl(entriesTable);
    try {
      const q = search.value.trim();
      const res = await api<{ entries: TmEntry[]; total: number }>(`/api/projects/${slug}/tm?lang=${encodeURIComponent(lang)}&q=${encodeURIComponent(q)}`);
      if (res.entries.length === 0) {
        const empty = h("div", { class: "empty" });
        empty.innerHTML = emptyIllustration();
        empty.appendChild(h("h3", {}, "No translation memory yet"));
        empty.appendChild(h("p", { class: "muted" }, "Import a TMX file or a spreadsheet to start reusing exact matches."));
        empty.appendChild(h("a", { class: "btn btn-primary", href: `/projects/${slug}/tm` }, "Import translation memory"));
        entriesTable.appendChild(empty);
        return;
      }
      const table = h("table", { class: "plain" });
      table.appendChild(h("thead", null, h("tr", null, h("th", null, "Source"), h("th", null, "Target"), h("th", null, "Language"))));
      const tbody = h("tbody");
      for (const e of res.entries) {
        tbody.appendChild(h("tr", { class: "tm-entry" },
          h("td", null, e.source),
          h("td", null, e.target),
          h("td", null, e.target_language),
        ));
      }
      table.appendChild(tbody);
      const wrap = h("div", { class: "table-wrap" });
      wrap.appendChild(table);
      entriesTable.appendChild(wrap);
    } catch (e: any) {
      entriesTable.appendChild(h("p", { class: "muted" }, "The desk couldn't reach the server. Check your connection and try again."));
    }
  }

  search.addEventListener("input", () => void loadEntries());
  await loadImports();
  // the report of the latest import stays on screen
  try {
    const imports = await api<{ imports: TmImport[] }>(`/api/projects/${slug}/tm/imports`);
    if (imports.imports.length > 0) {
      const report = await api<ImportReport>(`/api/projects/${slug}/tm/imports/${imports.imports[0].import_id}/report`);
      await loadReport(report);
    }
  } catch { /* no import yet */ }
  await loadEntries();
}
