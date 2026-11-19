import { get } from "../api";
import { copy } from "../copy";
import { h, setText } from "../dom";
import { PageHandle } from "../router";
import { buildFooter } from "../shell";
import { deviceId, useDevice } from "../state";
import { DeviceRow } from "../types";

/// The Devices page: one row per device with Online or Offline as the server
/// decides, and a button to make this browser that device.
export async function devicesPage(container: HTMLElement): Promise<PageHandle> {
  let destroyed = false;
  const header = h("div", { class: "panel-title" });
  const list = h("ul", { class: "list" });
  container.appendChild(
    h("main", {}, [h("div", { class: "band" }, [header, list])]),
  );
  container.appendChild(buildFooter());

  const rows = new Map<string, { line: HTMLElement; button: HTMLButtonElement }>();

  function renderHeader(devices: DeviceRow[]): void {
    const own = devices.find((device) => device.id === deviceId());
    setText(header, copy.devicesHeader(own?.name ?? deviceId()));
  }

  async function load(): Promise<void> {
    const payload = await get("/api/devices");
    if (destroyed) return;
    const devices = payload.devices as DeviceRow[];
    renderHeader(devices);
    for (const device of devices) {
      let row = rows.get(device.id);
      if (!row) {
        const line = h("div", {});
        const button = h(
          "button",
          { type: "button", class: "text-button" },
          `Use this browser as ${device.name}`,
        );
        button.addEventListener("click", () => {
          useDevice(device.id);
          renderHeader(devices);
        });
        list.appendChild(h("li", {}, [line, h("div", { class: "actions" }, [button])]));
        row = { line, button };
        rows.set(device.id, row);
      }
      setText(row.line, copy.deviceRow(device.name, device.online));
    }
  }

  await load();
  const refresh = window.setInterval(() => void load(), 5000);

  return {
    destroy(): void {
      destroyed = true;
      window.clearInterval(refresh);
    },
  };
}
