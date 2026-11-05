// The fleet register (DP-27, DP-63, DP-71).
import { api, ApiError } from "../api.js";
import { h, statusRegion, focusStatus, clearChildren } from "../ui/dom.js";
import { openDialog } from "../ui/dialog.js";
import { parseCents } from "../format.js";
import { INSTRUMENT_NAMES, SIZES_BY_TYPE, type InstrumentType } from "../../shared/domain.js";
import type { RenderContext } from "../router.js";

interface InstrumentRow {
  index: number;
  serial: string;
  instrument_type: string;
  size: string;
  model: string;
  label: string;
  status: string;
  contract_id: string | null;
  school_name: string | null;
}

interface FamilyRow {
  id: string;
  parent_name: string;
  email: string;
  phone: string;
  address: string;
  students: { id: string; name: string; grade: number; school_id: string }[];
}

const STATUS_WORDS: Record<string, string> = {
  available: "Available",
  on_contract: "On contract",
  sold: "Sold",
  retired: "Retired",
};

export async function renderRegister(ctx: RenderContext): Promise<void> {
  ctx.root.appendChild(h("h1", { text: "Fleet register" }));
  const status = statusRegion("Register status");
  const body = h("div", { class: "register-body" });

  async function load(): Promise<void> {
    const data = await api<{ instruments: InstrumentRow[] }>("GET", "/api/instruments");
    const user = ctx.user!;
    const families = user.role === "owner" ? await api<{ families: FamilyRow[] }>("GET", "/api/families") : null;
    clearChildren(body);
    body.appendChild(buildTable(data.instruments, user.role === "owner", families?.families ?? null, status, load));
  }

  ctx.root.append(body, status);
  await load();
}

function currentBand(): "narrow" | "medium" | "wide" {
  const width = window.innerWidth;
  if (width < 640) return "narrow";
  if (width < 1024) return "medium";
  return "wide";
}

function buildTable(
  instruments: InstrumentRow[],
  isOwner: boolean,
  families: FamilyRow[] | null,
  status: HTMLElement,
  reload: () => Promise<void>
): HTMLElement {
  const band = currentBand();

  const actionsBar = h("div", { class: "register-actions" });
  if (isOwner) {
    actionsBar.append(
      h("button", {
        class: "btn btn-secondary",
        text: "Add instrument",
        onclick: (event: MouseEvent) => openAddInstrument(event.currentTarget as HTMLElement, status, reload),
      }),
      h("button", {
        class: "btn btn-secondary",
        text: "Add student",
        onclick: (event: MouseEvent) => openAddStudent(event.currentTarget as HTMLElement, families, status, reload),
      })
    );
  }

  if (band === "narrow") {
    const list = h("ul", { class: "register-list", "aria-label": "Fleet register" });
    for (const row of instruments) {
      const item = h("li", { class: "register-item" });
      item.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("a")) {
          sessionStorage.setItem("bellroll:row-rect", JSON.stringify(item.getBoundingClientRect()));
        }
      });
      const firstLine = h("div", { class: "register-item-line" },
        h("span", { class: "mono index", text: String(row.index) }),
        row.contract_id
          ? h("a", { class: "mono serial-link", href: `/contracts/${row.contract_id}`, text: row.serial })
          : h("span", { class: "mono serial", text: row.serial })
      );
      const secondLine = h("div", { class: "register-item-line" },
        h("span", { text: row.label }),
        h("span", { class: "muted", text: STATUS_WORDS[row.status] ?? row.status })
      );
      item.append(firstLine, secondLine);
      list.appendChild(item);
    }
    return h("div", {}, actionsBar, list);
  }

  const columns =
    band === "medium"
      ? ["No.", "Serial", "Instrument", "Size", "School", "Status"]
      : ["No.", "Serial", "Instrument", "Size", "Model", "School", "Status"];

  const table = h("table", { class: "register-table", "aria-label": "Fleet register" });
  const thead = h("thead", {});
  const headRow = h("tr", {});
  for (const col of columns) headRow.appendChild(h("th", { scope: "col", text: col }));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = h("tbody", {});
  for (const row of instruments) {
    const tr = h("tr", { class: "register-row" });
    tr.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("a")) {
        sessionStorage.setItem("bellroll:row-rect", JSON.stringify(tr.getBoundingClientRect()));
      }
    });
    tr.appendChild(h("td", { class: "mono index", text: String(row.index) }));
    tr.appendChild(
      h("td", { class: "mono" },
        row.contract_id
          ? h("a", { class: "serial-link", href: `/contracts/${row.contract_id}`, text: row.serial })
          : row.serial
      )
    );
    tr.appendChild(h("td", { text: row.label }));
    tr.appendChild(h("td", { class: "mono", text: row.size }));
    if (band === "wide") tr.appendChild(h("td", { text: row.model }));
    tr.appendChild(h("td", { text: row.school_name ?? "—" }));
    tr.appendChild(h("td", { text: STATUS_WORDS[row.status] ?? row.status }));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return h("div", {}, actionsBar, table);
}

function openAddInstrument(opener: HTMLElement, status: HTMLElement, reload: () => Promise<void>): void {
  openDialog({
    name: "Add instrument",
    opener,
    build(body, close) {
      body.appendChild(h("h2", { text: "Add instrument" }));
      const serial = h("input", { class: "input", "aria-label": "Serial" });
      const serialField = fieldWith("Serial", serial, "serial");
      const typeSelect = h("select", { class: "input", "aria-label": "Instrument" });
      for (const type of Object.keys(INSTRUMENT_NAMES)) {
        typeSelect.appendChild(h("option", { value: type, text: INSTRUMENT_NAMES[type as InstrumentType] }));
      }
      const typeField = fieldWith("Instrument", typeSelect, "instrument_type");
      const sizeSelect = h("select", { class: "input", "aria-label": "Size" });
      const sizeField = fieldWith("Size", sizeSelect, "size");
      const rebuildSizes = (): void => {
        clearChildren(sizeSelect);
        for (const size of SIZES_BY_TYPE[typeSelect.value as InstrumentType]) {
          sizeSelect.appendChild(h("option", { value: size, text: size }));
        }
      };
      rebuildSizes();
      typeSelect.addEventListener("change", rebuildSizes);
      const model = h("input", { class: "input", "aria-label": "Model" });
      const modelField = fieldWith("Model", model, "model");

      const dialogStatus = statusRegion("Add instrument status", "status-text dialog-status");
      const save = h("button", {
        class: "btn btn-primary",
        text: "Save instrument",
        onclick: async () => {
          save.disabled = true;
          dialogStatus.textContent = "Saving…";
          try {
            const result = await api<{ instrument: { serial: string } }>("POST", "/api/instruments", {
              serial: serial.value,
              instrument_type: typeSelect.value,
              size: sizeSelect.value,
              model: model.value,
            });
            dialogStatus.textContent = "";
            status.textContent = `Added ${result.instrument.serial}.`;
            close();
            await reload();
            focusStatus("Register status");
          } catch (err) {
            save.disabled = false;
            if (err instanceof ApiError && err.status === 422 && err.fields) {
              markFields([serialField, typeField, sizeField, modelField], err.fields, ["serial", "instrument_type", "size", "model"]);
            } else if (err instanceof ApiError && err.code === "serial_taken") {
              markFields([serialField], { serial: `Serial ${serial.value} is already in the fleet.` }, ["serial"]);
            } else {
              dialogStatus.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
            }
          }
        },
      });
      const cancel = h("button", { class: "btn btn-secondary", text: "Cancel", onclick: close });
      body.append(serialField, typeField, sizeField, modelField, dialogStatus, h("div", { class: "dialog-actions" }, cancel, save));
    },
  });
}

function openAddStudent(opener: HTMLElement, families: FamilyRow[] | null, status: HTMLElement, reload: () => Promise<void>): void {
  openDialog({
    name: "Add student",
    opener,
    build(body, close) {
      body.appendChild(h("h2", { text: "Add student" }));
      const familySelect = h("select", { class: "input", "aria-label": "Family" });
      if (families) {
        for (const family of families) {
          familySelect.appendChild(h("option", { value: family.id, text: `${family.parent_name} (${family.id})` }));
        }
      }
      const familyField = fieldWith("Family", familySelect, "family_id");
      const schoolSelect = h("select", { class: "input", "aria-label": "School" });
      void api<{ schools: { id: string; name: string }[] }>("GET", "/api/schools").then((data) => {
        for (const school of data.schools) {
          schoolSelect.appendChild(h("option", { value: school.id, text: school.name }));
        }
      });
      const schoolField = fieldWith("School", schoolSelect, "school_id");
      const name = h("input", { class: "input", "aria-label": "Student name" });
      const nameField = fieldWith("Student name", name, "name");
      const grade = h("input", { class: "input", "aria-label": "Grade", type: "number", min: "0", max: "12" });
      const gradeField = fieldWith("Grade", grade, "grade");

      const dialogStatus = statusRegion("Add student status", "status-text dialog-status");
      const save = h("button", {
        class: "btn btn-primary",
        text: "Save student",
        onclick: async () => {
          save.disabled = true;
          dialogStatus.textContent = "Saving…";
          try {
            const result = await api<{ student: { name: string } }>("POST", "/api/students", {
              family_id: familySelect.value,
              school_id: schoolSelect.value,
              name: name.value,
              grade: parseCents(grade.value) !== null ? Number(grade.value) : null,
            });
            dialogStatus.textContent = "";
            status.textContent = `Added ${result.student.name}.`;
            close();
            await reload();
            focusStatus("Register status");
          } catch (err) {
            save.disabled = false;
            if (err instanceof ApiError && err.status === 422 && err.fields) {
              markFields([familyField, schoolField, nameField, gradeField], err.fields, ["family_id", "school_id", "name", "grade"]);
            } else {
              dialogStatus.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
            }
          }
        },
      });
      const cancel = h("button", { class: "btn btn-secondary", text: "Cancel", onclick: close });
      body.append(familyField, schoolField, nameField, gradeField, dialogStatus, h("div", { class: "dialog-actions" }, cancel, save));
    },
  });
}

function fieldWith(label: string, input: HTMLElement, key: string): HTMLElement {
  const message = h("span", { class: "field-message", id: `msg-${key}` });
  input.setAttribute("aria-describedby", `msg-${key}`);
  const wrap = h("label", { class: "field", "data-field": key },
    h("span", { class: "field-label", text: label }),
    input,
    message
  );
  return wrap;
}

// Every invalid field is reported at once, each message tied to its field,
// and focus moves to the first invalid field (DP-71).
function markFields(fields: HTMLElement[], messages: Record<string, string>, order: string[]): void {
  let firstInvalid: HTMLElement | null = null;
  for (const field of fields) {
    const key = field.dataset.field ?? "";
    const input = field.querySelector("input, select") as HTMLElement;
    const messageEl = field.querySelector(".field-message") as HTMLElement;
    const message = key in messages ? messages[key] : null;
    if (message) {
      field.classList.add("field-invalid");
      input.setAttribute("aria-invalid", "true");
      messageEl.textContent = message;
      if (!firstInvalid) firstInvalid = input;
    } else {
      field.classList.remove("field-invalid");
      input.removeAttribute("aria-invalid");
      messageEl.textContent = "";
    }
  }
  void order;
  firstInvalid?.focus();
}

export { markFields, fieldWith };
