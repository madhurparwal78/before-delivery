// Settings: the home time zone picker with its notice, and the size unit.

import type { ScreenContext } from "./main.js";
import { api, ApiError, type SettingsBody } from "./api.js";
import type { Unit } from "../shared/domain.js";
import { el, text, buildTile, deckStatus, type TileParts } from "./dom.js";
import { COPY, formatDate } from "./copy.js";

// The picker lists exactly the accepted zones, in code-point order.
const ZONES: string[] = await fetch("/api/settings/zones")
  .then((res) => (res.ok ? res.json() : { zones: [] }))
  .then((body: { zones?: string[] }) => body.zones ?? [])
  .catch(() => []);

export class SettingsScreen {
  private tile: TileParts;
  private select!: HTMLSelectElement;
  private notice!: HTMLElement;

  constructor(private ctx: ScreenContext) {
    this.tile = buildTile("Current reference");
    this.tile.showEmpty(COPY.openingDeck);
    ctx.field.append(this.tile.figure);
    ctx.main.append(text("h1", "Settings"));

    const zoneLabel = el("label", { for: "home-zone" });
    zoneLabel.textContent = "Home time zone";
    this.select = document.createElement("select");
    this.select.id = "home-zone";
    this.select.setAttribute("aria-label", "Home time zone");
    for (const zone of ZONES) {
      const option = el("option", { value: zone });
      option.textContent = zone;
      this.select.append(option);
    }
    this.notice = text("p", "", { class: "settings-zone-note" });
    const save = el("button", { type: "button", class: "primary" });
    save.textContent = "Save home zone";
    save.addEventListener("click", () => void this.saveZone());
    const group = el("fieldset");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Size unit");
    const legend = el("legend");
    legend.textContent = "Size unit";
    group.append(legend);
    for (const unit of ["mm", "in"] as Unit[]) {
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "settings-unit";
      radio.value = unit;
      radio.setAttribute("aria-label", unit);
      radio.addEventListener("change", async () => {
        if (!radio.checked) return;
        try {
          const settings = await api.saveUnit(unit);
          deckStatus.set(COPY.unitNow(settings.unit === "mm" ? "millimetres" : "inches"));
        } catch { deckStatus.set(COPY.genericFailure); }
      });
      group.append(radio);
    }
    ctx.main.append(zoneLabel, this.select, this.notice, save, group);
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const settings = await api.settings();
      this.paint(settings);
    } catch { /* the next load retries */ }
  }

  private paint(settings: SettingsBody): void {
    this.select.value = settings.home_zone;
    if (this.pendingValue) this.select.value = this.pendingValue;
    const radio = this.ctx.main.querySelector<HTMLInputElement>(`input[name="settings-unit"][value="${settings.unit}"]`);
    if (radio) radio.checked = true;
    this.notice.textContent = settings.pending_zone
      ? COPY.zoneNoticePending(settings.pending_zone.zone, formatDate(settings.pending_zone.effective_date), settings.home_zone)
      : COPY.zoneNoticeCurrent(settings.home_zone);
  }

  private pendingValue: string | null = null;

  private async saveZone(): Promise<void> {
    try {
      const settings = await api.saveZone(this.select.value);
      this.pendingValue = null;
      deckStatus.set(COPY.zoneNoticePending(
        settings.pending_zone ? settings.pending_zone.zone : settings.home_zone,
        settings.pending_zone ? formatDate(settings.pending_zone.effective_date) : "",
        settings.home_zone,
      ));
      this.paint(settings);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        deckStatus.set(COPY.capture422);
        this.select.setAttribute("aria-invalid", "true");
      } else {
        deckStatus.set(COPY.genericFailure);
      }
    }
  }
}
