import type { ImportReport } from "../../shared/types.js";
import { api, ApiFailure } from "../api.js";
import { h } from "../dom.js";
import { feedback } from "../ui.js";

/** The legacy feedback import: preview then import (DP-15, DP-16). */
export function renderImport(
  _screen: HTMLElement,
  fail: (err: unknown) => void,
): HTMLElement {
  const root = h("div", null);
  root.appendChild(h("h2", null, "Import legacy feedback"));

  const csv = h("textarea", {
    "aria-label": "CSV",
    placeholder: "Paste contact_email,contact_name,company_name,feedback,received_on here",
  }) as HTMLTextAreaElement;
  const previewButton = h("button", null, "Preview import") as HTMLButtonElement;
  const importButton = h("button", { class: "primary", disabled: true }, "Import rows") as HTMLButtonElement;
  const error = h("span", { class: "field-error" });
  let report: ImportReport | null = null;
  let previewedFor = "";

  const previewTable = h("div", null);

  const renderPreview = (): void => {
    previewTable.replaceChildren();
    if (report === null) return;
    const totals = report.totals;
    previewTable.appendChild(
      h("p", null,
        `Preview ready: ${totals.created} created, ${totals.matched} matched, ${totals.skipped} skipped. Nothing has been imported yet.`,
      ),
    );
    const table = h("table", { "aria-label": "Import preview" });
    table.appendChild(h("thead", null,
      h("tr", null,
        h("th", null, "Line"),
        h("th", null, "Outcome"),
        h("th", null, "Reason"),
      ),
    ));
    const tbody = h("tbody", null);
    for (const row of report.rows) {
      tbody.appendChild(h("tr", null,
        h("td", { class: "num" }, String(row.line)),
        h("td", null, row.outcome),
        h("td", null, row.reason ?? ""),
      ));
    }
    table.appendChild(tbody);
    previewTable.appendChild(table);
  };

  previewButton.addEventListener("click", async () => {
    error.replaceChildren();
    previewButton.textContent = "Reading CSV…";
    importButton.disabled = true;
    try {
      report = await api.previewImport(csv.value);
      previewedFor = csv.value;
      importButton.disabled = false;
      previewButton.textContent = "Preview import";
      renderPreview();
    } catch (err) {
      previewButton.textContent = "Preview import";
      if (err instanceof ApiFailure) {
        error.replaceChildren(err.error.error.fields?.csv ?? err.error.error.message);
      } else {
        fail(err);
      }
    }
  });

  importButton.addEventListener("click", async () => {
    if (report === null) return;
    importButton.textContent = "Importing…";
    try {
      const run = await api.runImport(csv.value);
      const totals = run.totals;
      feedback?.saveStatus(
        `Imported ${totals.notes} notes: ${totals.created} created, ${totals.matched} matched, ${totals.skipped} skipped.`,
      );
      importButton.textContent = "Import rows";
    } catch (err) {
      importButton.textContent = "Import rows";
      if (err instanceof ApiFailure) {
        feedback?.alert(err.error.error.fields?.csv ?? err.error.error.message);
      }
    }
  });

  // The import button is disabled until a preview succeeds for this text.
  csv.addEventListener("input", () => {
    if (csv.value !== previewedFor) {
      importButton.disabled = true;
      report = null;
      renderPreview();
    }
  });

  root.appendChild(h("p", null, "Paste a legacy feedback CSV saved from a spreadsheet program."));
  root.appendChild(h("label", null, "CSV"));
  root.appendChild(csv);
  root.appendChild(error);
  root.appendChild(h("div", { class: "toolbar-actions" }, previewButton, importButton));
  root.appendChild(previewTable);
  return root;
}
