import { ApiFailure, get, upload } from "../api";
import { copy, stampLine } from "../copy";
import { clear, h, setText } from "../dom";
import { LiveEvent, onLive } from "../live";
import { PageHandle } from "../router";
import { buildFooter } from "../shell";
import { Farm, ImportRow, LegacyImport } from "../types";

const IMPORT_LIMIT = 2_000_000;

/// The Imports page: the older tool's CSV, its summary in five tables, and the
/// farm's past imports.
export async function importsPage(container: HTMLElement): Promise<PageHandle> {
  let farms: Farm[] = [];
  let imports: LegacyImport[] = [];
  let chosen: File | null = null;
  let farmSequence = 0;
  let importSequence = 0;
  let destroyed = false;

  const farmSelect = h("select", { "aria-label": "Farm" });
  const chooseButton = h("button", { type: "button", class: "text-button" }, "Choose legacy CSV");
  const fileInput = h("input", {
    type: "file",
    accept: ".csv,text/csv",
    class: "sr-only",
    "aria-hidden": "true",
    tabindex: "-1",
  });
  const chosenName = h("span", { class: "label" });
  const importButton = h("button", { type: "button", class: "text-button" }, "Import");
  const status = h("div", { role: "status", "aria-label": "Import status" });
  const tables = h("div", {});
  const pastList = h("ul", { class: "list" });

  const main = h("main", {}, [
    h("div", { class: "band" }, [
      h("label", { class: "field" }, [h("span", {}, "Farm"), farmSelect]),
      h("div", { class: "actions" }, [chooseButton, fileInput, chosenName, importButton]),
      status,
    ]),
    h("div", { class: "page" }, tables),
    h("div", { class: "band" }, [h("div", { class: "panel-title" }, "Past imports"), pastList]),
  ]);
  container.appendChild(main);
  container.appendChild(buildFooter());

  const SECTIONS: [string, (row: ImportRow) => string[]][] = [
    ["Created", (row) => [String(row.row), row.defect_id ?? ""]],
    ["Merged", (row) => [String(row.row), row.defect_id ?? ""]],
    ["Already imported", (row) => [String(row.row), row.defect_id ?? ""]],
    ["Orphans", (row) => [String(row.row), `${row.site_code ?? ""} ${row.pen_no ?? ""}`]],
    ["Invalid", (row) => [String(row.row), row.reason ?? ""]],
  ];

  function renderSummary(record: LegacyImport | null): void {
    clear(tables);
    for (const [title, cells] of SECTIONS) {
      const key = title.toLowerCase().replace(" ", "_") as keyof LegacyImport;
      const rows = record ? ((record[key] as ImportRow[]) ?? []) : [];
      const table = h("table", { "aria-label": title }, [
        h("caption", {}, title),
        h("thead", {}, h("tr", {}, [h("th", {}, "Row"), h("th", {}, "Detail")])),
        h(
          "tbody",
          {},
          rows.map((row) =>
            h("tr", {}, cells(row).map((cell) => h("td", { class: "num" }, cell))),
          ),
        ),
      ]);
      tables.appendChild(table);
    }
  }

  function renderPast(): void {
    clear(pastList);
    for (const record of imports) {
      pastList.appendChild(
        h("li", {}, [
          h("div", { class: "num" }, `${record.id} \u00b7 ${stampLine(record.imported_at)}`),
          h(
            "a",
            {
              href: `/api/imports/${record.id}/raw`,
              download: record.file_name,
              "aria-label": `Download original ${record.file_name}`,
            },
            `Download original ${record.file_name}`,
          ),
        ]),
      );
    }
  }

  async function loadFarm(): Promise<void> {
    const token = ++farmSequence;
    const payload = await get(`/api/farms/${farmSelect.value}/imports`);
    if (destroyed || token !== farmSequence) return;
    imports = payload.imports as LegacyImport[];
    renderPast();
    renderSummary(imports[0] ?? null);
  }

  chooseButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    chosen = fileInput.files?.[0] ?? null;
    setText(chosenName, chosen ? chosen.name : "");
  });

  /// After a double click on Import, the status shows the reply to the most
  /// recent press. The server is the guarantee.
  importButton.addEventListener("click", async () => {
    if (!chosen) return;
    const token = ++importSequence;
    const file = chosen;
    setText(status, copy.importing);
    if (file.size > IMPORT_LIMIT) {
      setText(status, copy.importTooLarge);
      return;
    }
    try {
      const payload = await upload(
        `/api/farms/${farmSelect.value}/imports`,
        file,
        file.name,
        "text/csv",
      );
      const record = payload.import as LegacyImport;
      const replayed = payload.replayed as boolean;
      await loadFarm();
      if (token !== importSequence) return;
      renderSummary(record);
      setText(
        status,
        replayed
          ? copy.importReplay
          : copy.imported(
              record.file_name,
              record.created.length,
              record.merged.length,
              record.already_imported.length,
              record.orphans.length,
              record.invalid.length,
            ),
      );
    } catch (failure) {
      if (token !== importSequence) return;
      setText(status, failure instanceof ApiFailure ? failure.message : copy.unreachable);
    }
  });

  farmSelect.addEventListener("change", () => void loadFarm());

  const payload = await get("/api/farms");
  farms = payload.farms as Farm[];
  for (const farm of farms) {
    farmSelect.appendChild(h("option", { value: farm.id }, farm.name));
  }
  if (farms.length) farmSelect.value = farms[0].id;
  await loadFarm();

  /// A file the other device imports joins this list in place.
  const unsubscribe = onLive((event: LiveEvent) => {
    if (event.type !== "import.created") return;
    if (event.farm_id !== farmSelect.value) return;
    const record = event.import as LegacyImport;
    imports = [record, ...imports.filter((entry) => entry.id !== record.id)];
    renderPast();
  });

  return {
    destroy(): void {
      destroyed = true;
      unsubscribe();
    },
  };
}
