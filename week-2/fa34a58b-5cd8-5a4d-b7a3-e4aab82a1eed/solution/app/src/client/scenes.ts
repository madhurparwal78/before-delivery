// The Scenes page: the catalogue, and the New scene / Edit scene sheet.

import { TINTS, type Scene, type Tint } from "../shared/types.ts";
import { api, HubUnreachable } from "./api.ts";
import { h, num, pulse, setText, uid } from "./dom.ts";
import { icon } from "./icons.ts";
import { live } from "./live.ts";
import { field, input, showError } from "./forms.ts";
import { Sheet, sheetHeader } from "./sheets.ts";
import type { Shell } from "./shell.ts";

const TINT_NAMES: Record<Tint, string> = {
  amber: "Amber", honey: "Honey", ember: "Ember", rose: "Rose", dusk: "Dusk", candle: "Candle",
};
const DEFAULT_BRIGHTNESS = "50";

function sceneMeta(scene: Scene): HTMLElement {
  return h("span", { class: "muted facts" },
    h("span", { class: "fact" }, num(`Brightness ${scene.brightness}%`)), " · ",
    h("span", { class: "fact" }, num(scene.setpoint_f === null ? "No setpoint" : `Setpoint ${scene.setpoint_f}°F`)));
}

export function scenesPage(shell: Shell): void {
  const list = h("ul", { class: "card-list", "aria-label": "Scenes" });
  const create = h("button", { type: "button", class: "btn btn-primary" }, icon("plus"), h("span", {}, "New scene"));
  shell.main.append(
    h("div", { class: "page-head" }, h("h1", {}, "Scenes"), create),
    h("p", { class: "lede" }, "Each scene sets the lights and thermostats of the rooms a schedule slot gives it."),
    list,
  );

  // ---- sheet ---------------------------------------------------------------------------------
  const title = h("h2", { class: "sheet-title" });
  const panel = h("div", { class: "sheet sheet-wide" });
  const sheet = new Sheet({ element: panel, label: "New scene" });
  const name = field("Scene name", input({ maxlength: 60 }));
  const tintLabelId = uid("tint");
  const tintError = h("p", { class: "field-error", id: uid("error"), hidden: true });
  const radios = TINTS.map((tint) => h("input", { type: "radio", name: "tint", value: tint, class: "choice-input" }));
  const tintGroup = h("div", { role: "radiogroup", "aria-labelledby": tintLabelId, "aria-describedby": tintError.id, class: "tint-choices" },
    ...TINTS.map((tint, index) => h("label", { class: "choice" }, radios[index] as HTMLInputElement,
      h("span", { class: `swatch swatch-${tint}`, "aria-hidden": "true" }), TINT_NAMES[tint])));
  const tintField = { error: tintError, control: tintGroup };
  const brightness = field("Brightness", input({ type: "number", min: 0, max: 100, step: 1, inputmode: "numeric", class: "input input-short" }), "0 to 100 %. 0 turns lights off.");
  const setpoint = field("Setpoint", input({ type: "number", min: 60, max: 80, step: 1, inputmode: "numeric", class: "input input-short" }), "60 to 80 °F. Leave empty to leave thermostats alone.");
  const submit = h("button", { type: "submit", class: "btn btn-primary" });
  const status = h("p", { role: "status", "aria-label": "Scene save", class: "form-status" });
  const form = h("form", { class: "sheet-body", novalidate: true },
    name.wrap,
    h("div", { class: "field" }, h("p", { class: "field-label", id: tintLabelId }, "Tint"), tintGroup, tintError),
    brightness.wrap, setpoint.wrap,
    h("div", { class: "form-actions" }, submit), status);
  panel.append(sheetHeader(() => sheet, title), form);

  let editing: Scene | null = null;
  const brightnessInput = brightness.control as HTMLInputElement;
  const setpointInput = setpoint.control as HTMLInputElement;
  const nameInput = name.control as HTMLInputElement;

  function fill(scene: Scene | null): void {
    nameInput.value = scene?.name ?? "";
    for (const radio of radios) radio.checked = radio.value === (scene?.tint ?? "amber");
    brightnessInput.value = scene ? String(scene.brightness) : DEFAULT_BRIGHTNESS;
    setpointInput.value = scene?.setpoint_f == null ? "" : String(scene.setpoint_f);
    for (const target of [name, tintField, brightness, setpoint]) showError(target, undefined);
  }

  function openSheet(scene: Scene | null, opener: HTMLElement): void {
    editing = scene;
    const label = scene ? `Edit ${scene.name}` : "New scene";
    sheet.setLabel(label);
    setText(title, label);
    setText(submit, scene ? "Save scene" : "Create scene");
    status.textContent = "";
    fill(scene);
    sheet.open(opener);
  }

  const numberOrNull = (text: string): number | null => (text.trim() === "" ? null : Number(text));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      name: nameInput.value,
      tint: radios.find((radio) => radio.checked)?.value ?? null,
      brightness: numberOrNull(brightnessInput.value),
      setpoint_f: numberOrNull(setpointInput.value),
    };
    const target = editing;
    status.textContent = target ? "Saving scene…" : "Creating scene…";
    try {
      const result = target
        ? await api<{ scene: Scene }>("PUT", `/api/scenes/${encodeURIComponent(target.id)}`, body)
        : await api<{ scene: Scene }>("POST", "/api/scenes", body);
      const fields = result.ok ? {} : (result.error.fields ?? {});
      showError(name, fields.name);
      showError(tintField, fields.tint);
      showError(brightness, fields.brightness);
      showError(setpoint, fields.setpoint_f);
      if (!result.ok) {
        status.textContent = result.error.message;
        return;
      }
      upsert(result.data.scene);
      if (target) {
        editing = result.data.scene;
        status.textContent = "Scene saved.";
      } else {
        fill(null);
        status.textContent = "Scene created. Add it to a schedule slot to give it rooms.";
      }
    } catch (error) {
      if (!(error instanceof HubUnreachable)) throw error;
      status.textContent = "";
    }
  });

  // ---- list ----------------------------------------------------------------------------------
  const rows = new Map<string, HTMLElement>();
  function row(scene: Scene): HTMLElement {
    const edit = h("button", { type: "button", class: "btn", "aria-label": `Edit ${scene.name}` }, "Edit");
    edit.addEventListener("click", () => openSheet(live.scene(scene.id) ?? scene, edit));
    return h("li", { class: "card scene-card", "data-scene": scene.id },
      h("span", { class: `swatch swatch-lg swatch-${scene.tint}`, "aria-hidden": "true" }),
      h("span", { class: "card-text" }, h("span", { class: "scene-name" }, scene.name), sceneMeta(scene)),
      edit);
  }
  function upsert(scene: Scene): void {
    const fresh = row(scene);
    const old = rows.get(scene.id);
    if (old) old.replaceWith(fresh);
    else list.append(fresh);
    rows.set(scene.id, fresh);
    if (old) pulse(fresh);
  }
  for (const scene of live.scenes) upsert(scene);
  live.on("scene", (message) => upsert(message.scene));
  create.addEventListener("click", () => openSheet(null, create));
}
