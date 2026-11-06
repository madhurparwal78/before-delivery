// Device rows in the room inspector and the device sheet. The newest action wins: changes made while
// a request is pending are queued behind it, so the switch, the sheet and the server all settle on the newest change.

import type { Device } from "../shared/types.ts";
import { api, HubUnreachable } from "./api.ts";
import { h, pulse, setNum, setText, uid } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";
import { live, secondsOf } from "./live.ts";
import { Sheet, sheetHeader } from "./sheets.ts";

type Change = { on?: boolean; brightness?: number; setpoint_f?: number };
type View = (control: DeviceControl) => void;

/** One device's server state, plus what the user asked for that the server has not answered yet. */
class DeviceControl {
  device: Device;
  private sending: Change | null = null;
  private waiting: Change | null = null;
  refusal = "";
  private readonly views = new Set<View>();

  constructor(device: Device) {
    this.device = device;
  }

  get pending(): boolean {
    return this.sending !== null || this.waiting !== null;
  }

  /** The state to show: the server's, overlaid with the in-flight and the queued change. */
  get shown(): { on: boolean; brightness: number; setpoint_f: number; current_f: number } {
    const state = this.device.state as { on?: boolean; brightness?: number; setpoint_f?: number; current_f?: number };
    return {
      on: state.on ?? false,
      brightness: state.brightness ?? 0,
      setpoint_f: state.setpoint_f ?? 0,
      current_f: state.current_f ?? 0,
      ...this.sending,
      ...this.waiting,
    };
  }

  watch(view: View): () => void {
    this.views.add(view);
    view(this);
    return () => this.views.delete(view);
  }

  render(): void {
    for (const view of this.views) view(this);
  }

  fromServer(device: Device): void {
    this.device = device;
    this.render();
  }

  change(change: Change): void {
    this.refusal = "";
    if (this.sending) this.waiting = { ...this.waiting, ...change };
    else void this.send(change);
    this.render();
  }

  private async send(change: Change): Promise<void> {
    this.sending = change;
    this.render();
    try {
      const result = await api<{ device: Device }>("PUT", `/api/devices/${encodeURIComponent(this.device.id)}/state`, change);
      if (result.ok) {
        if (result.data.device.revision >= this.device.revision) this.device = result.data.device;
      } else {
        this.refusal = result.error.message;
        this.waiting = null;
      }
    } catch (error) {
      if (!(error instanceof HubUnreachable)) throw error;
      this.waiting = null;
    }
    this.sending = null;
    const next = this.waiting;
    this.waiting = null;
    if (next) void this.send(next);
    this.render();
  }
}

const controls = new Map<string, DeviceControl>();
function controlFor(device: Device): DeviceControl {
  let control = controls.get(device.id);
  if (!control) {
    control = new DeviceControl(device);
    controls.set(device.id, control);
  }
  return control;
}

live.on("device", (message) => {
  const control = controls.get(message.device.id);
  if (control && message.device.revision >= control.device.revision) control.fromServer(message.device);
});

const KIND_ICON: Record<Device["kind"], IconName> = {
  light: "lightbulb", plug: "plug", thermostat: "thermometer", camera: "video",
};

function stateText(control: DeviceControl): string {
  const { device } = control;
  const shown = control.shown;
  if (device.kind === "thermostat") return `Set to ${shown.setpoint_f}°F, reading ${shown.current_f}°F`;
  if (device.kind === "camera") return "Camera";
  if (device.kind === "plug") return shown.on ? "On" : "Off";
  return shown.on ? `On at ${shown.brightness}%` : "Off";
}

/** A switch button (role switch) whose name comes from `labelledBy` or `label`. */
function powerSwitch(attrs: { labelledBy?: string; label?: string }, onFlip: (on: boolean) => void): HTMLButtonElement {
  const button = h("button", {
    type: "button", role: "switch", class: "switch", "aria-checked": "false",
    "aria-labelledby": attrs.labelledBy, "aria-label": attrs.label,
  }, h("span", { class: "switch-track", "aria-hidden": "true" }, h("span", { class: "switch-knob" })));
  button.addEventListener("click", () => onFlip(button.getAttribute("aria-checked") !== "true"));
  return button;
}

/** The inspector's device list for one room. */
export function deviceList(roomId: string, alert: HTMLElement, openSheet: (device: Device, opener: HTMLElement) => void): {
  element: HTMLUListElement;
  dispose: () => void;
} {
  const list = h("ul", { class: "devices", "aria-label": "Devices" });
  const stops: (() => void)[] = [];
  for (const device of [...live.devices.values()].filter((candidate) => candidate.room_id === roomId)) {
    const control = controlFor(device);
    const nameId = uid("device");
    const state = h("span", { class: "device-state" });
    const sending = h("span", { class: "sending" });
    const offline = h("span", { class: "badge badge-alert", hidden: true }, "Offline");
    const toggle = device.kind === "light" || device.kind === "plug"
      ? powerSwitch({ labelledBy: nameId }, (on) => control.change({ on }))
      : null;
    const details = h("button", { type: "button", class: "icon-btn", "aria-label": `Details for ${device.name}` }, icon("chevron-right"));
    details.addEventListener("click", () => openSheet(control.device, details));
    const row = h(
      "li", { class: "device" },
      h("span", { class: "device-icon", "aria-hidden": "true" }, icon(KIND_ICON[device.kind])),
      h("span", { class: "device-text" }, h("span", { class: "device-name", id: nameId }, device.name), state,
        h("span", { class: "device-flags" }, offline, sending)),
      toggle, details,
    );
    let lastRevision = device.revision;
    stops.push(control.watch(() => {
      setNum(state, stateText(control));
      setText(sending, control.pending ? "Sending…" : "");
      offline.hidden = control.device.online;
      toggle?.setAttribute("aria-checked", String(control.shown.on));
      if (control.refusal) {
        alert.hidden = false;
        alert.textContent = control.refusal;
        alert.dataset.device = device.id;
      } else if (alert.dataset.device === device.id) {
        alert.hidden = true;
        alert.textContent = "";
        delete alert.dataset.device;
      }
      if (control.device.revision !== lastRevision) {
        lastRevision = control.device.revision;
        pulse(row);
      }
    }));
    list.append(row);
  }
  return { element: list, dispose: () => stops.forEach((stop) => stop()) };
}

/** The device details sheet, reused for every device. */
export class DeviceSheet {
  private readonly sheet: Sheet;
  private readonly title = h("h2", { class: "sheet-title" });
  private readonly body = h("div", { class: "sheet-body" });
  private stop: (() => void) | null = null;

  constructor() {
    const panel = h("div", { class: "sheet sheet-narrow" });
    this.sheet = new Sheet({ element: panel, label: "Device", onClose: () => this.stop?.() });
    panel.append(sheetHeader(() => this.sheet, this.title), this.body);
  }

  open(device: Device, opener: HTMLElement): void {
    this.stop?.();
    const control = controlFor(device);
    this.sheet.setLabel(device.name);
    setText(this.title, device.name);
    const online = h("p", { class: "device-online" });
    const report = h("p", { class: "muted" });
    const alert = h("p", { class: "inline-alert", role: "alert", hidden: true });
    const sending = h("span", { class: "sending" });
    const reading = h("p", { class: "muted" });
    const fields: HTMLElement[] = [];
    let power: HTMLButtonElement | null = null;
    let brightness: HTMLInputElement | null = null;
    let brightnessValue: HTMLElement | null = null;
    let setpoint: HTMLInputElement | null = null;
    if (device.kind === "light" || device.kind === "plug") {
      power = powerSwitch({ label: "Power" }, (on) => control.change({ on }));
      fields.push(h("div", { class: "field-row" }, h("span", { class: "field-label", "aria-hidden": "true" }, "Power"), power, sending));
    }
    if (device.kind === "light") {
      const id = uid("brightness");
      brightness = h("input", { id, type: "range", min: 1, max: 100, step: 1, class: "range" });
      brightnessValue = h("output", { for: id, class: "num" });
      const input = brightness;
      input.addEventListener("input", () => brightnessValue && setNum(brightnessValue, `${input.value}%`));
      input.addEventListener("change", () => control.change({ brightness: Number(input.value) }));
      fields.push(h("div", { class: "field" }, h("label", { for: id }, "Brightness"), h("div", { class: "range-row" }, input, brightnessValue)));
    }
    if (device.kind === "thermostat") {
      const id = uid("setpoint");
      setpoint = h("input", { id, type: "number", min: 60, max: 80, step: 1, class: "input input-short", inputmode: "numeric" });
      const input = setpoint;
      let stepped = false;
      input.addEventListener("keydown", (event) => {
        stepped = ["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key);
      });
      const sendSetpoint = () => {
        const value = Number(input.value);
        if (input.value !== "" && Number.isInteger(value) && value >= 60 && value <= 80 && value !== control.shown.setpoint_f) {
          control.change({ setpoint_f: value });
        }
      };
      input.addEventListener("input", () => {
        if (stepped) sendSetpoint();
      });
      input.addEventListener("change", sendSetpoint);
      fields.push(h("div", { class: "field" }, h("label", { for: id }, "Setpoint"),
        h("div", { class: "range-row" }, input, h("span", { class: "muted" }, "°F")), reading));
    }
    if (device.kind === "camera") fields.push(h("p", { class: "muted" }, "Camera"));
    this.body.replaceChildren(h("div", { class: "device-status" }, online, report), alert, ...fields);
    this.stop = control.watch(() => {
      const shown = control.shown;
      setText(online, control.device.online ? "Online" : "Offline");
      online.classList.toggle("is-offline", !control.device.online);
      setNum(report, `Last report ${secondsOf(control.device.updated_at)}`);
      setText(sending, control.pending ? "Sending…" : "");
      power?.setAttribute("aria-checked", String(shown.on));
      if (brightness && document.activeElement !== brightness) {
        brightness.value = String(shown.brightness);
        if (brightnessValue) setNum(brightnessValue, `${shown.brightness}%`);
      }
      if (setpoint && !(document.activeElement === setpoint && control.pending)) setpoint.value = String(shown.setpoint_f);
      setNum(reading, `Reading ${shown.current_f}°F`);
      alert.hidden = !control.refusal;
      alert.textContent = control.refusal;
    });
    this.sheet.open(opener);
  }
}

