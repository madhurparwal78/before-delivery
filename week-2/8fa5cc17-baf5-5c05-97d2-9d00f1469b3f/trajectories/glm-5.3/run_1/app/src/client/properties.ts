// The Properties region: one control per typed field.

import { api, apiFail, type ObjectJson, type TypeJson, type BlockJson } from "./api.js";
import { h, clearAlert, alertMessage } from "./dom.js";
import { state } from "./app.js";

export function buildProperties(object: ObjectJson, type: TypeJson): HTMLElement {
  const host = h("section", { "aria-label": "Properties", class: "properties" });
  const status = (): HTMLElement | null => document.getElementById("save-status");
  for (const field of type.fields) {
    const value = object.properties[field.name] ?? null;
    const id = `prop-${field.name.replace(/\W/g, "-")}`;
    let control: HTMLElement;
    if (field.kind === "select") {
      const sel = h("select", { id, "aria-label": field.name });
      sel.append(h("option", { value: "" }, "None"));
      for (const opt of field.options ?? []) {
        sel.append(h("option", { value: opt, selected: value === opt }, opt));
      }
      if (value !== null) sel.value = String(value);
      sel.addEventListener("change", () => {
        void saveProperty(object, field.name, sel.value === "" ? null : sel.value, status());
      });
      control = sel;
    } else if (field.kind === "relation") {
      const sel = h("select", { id, "aria-label": field.name });
      sel.append(h("option", { value: "" }, "None"));
      const targets = state.app?.types.find((t) => t.id === field.target_type_id);
      const options: Array<{ id: string; title: string }> = [];
      if (targets !== undefined) {
        void api<{ objects: Array<{ id: string; title: string }> }>("GET", `/api/objects?type_id=${targets.id}`).then((res) => {
          const sorted = res.objects.slice().sort((a, b) => a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1);
          for (const o of sorted) {
            options.push(o);
            sel.append(h("option", { value: o.id, selected: value === o.id }, o.title));
          }
          if (value !== null) sel.value = String(value);
        });
      }
      sel.addEventListener("change", () => {
        void saveProperty(object, field.name, sel.value === "" ? null : sel.value, status());
      });
      control = sel;
    } else if (field.kind === "number") {
      const input = h("input", { type: "number", id, "aria-label": field.name, role: "spinbutton", value: value === null ? "" : String(value) });
      const save = (): void => {
        const v = input.value === "" ? null : Number(input.value);
        void saveProperty(object, field.name, v, status());
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
      });
      input.addEventListener("blur", save);
      control = input;
    } else {
      const input = h("input", { type: "text", id, "aria-label": field.name, value: value === null ? "" : String(value) });
      const save = (): void => {
        void saveProperty(object, field.name, input.value === "" ? null : input.value, status());
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
      });
      input.addEventListener("blur", save);
      control = input;
    }
    host.append(h("div", { class: "property-row" }, h("label", { for: id }, field.name), control));
  }
  return host;
}

async function saveProperty(object: ObjectJson, field: string, value: unknown, statusEl: HTMLElement | null): Promise<void> {
  clearAlert();
  if (statusEl !== null) statusEl.textContent = "Saving";
  try {
    await api("PATCH", `/api/objects/${object.id}`, { properties: { [field]: value } });
    if (statusEl !== null) statusEl.textContent = "Saved";
  } catch (e) {
    if (statusEl !== null) statusEl.textContent = "Not saved. Check your connection and try again.";
    alertMessage(apiFail(e, `properties.${field}`));
  }
}
