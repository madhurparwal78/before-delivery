import { api, ApiError } from "../api";
import { el, fmtMoney } from "../ui";
import { state } from "../main";

interface RateCard {
  id: string;
  effective_from: string;
  tier_rates_cents: number[];
  station_surcharges_cents: Record<string, number>;
  cancellation_window_hours: number;
  pack_price_cents: number;
  in_force: boolean;
}

export function renderRates(container: HTMLElement): void {
  const wide = el("div", { class: "wide editorial" });
  wide.append(el("h1", { class: "page-title", text: "Rates" }));
  const statusRegion = el("div", { role: "status", "aria-label": "Form status", class: "status-line" });

  const cutoffSection = el("section", { class: "first" });
  cutoffSection.append(el("h2", { text: "Same-day cutoff" }));
  const cutoffField = el("div", { class: "field" });
  const cutoffLabel = el("label", { for: "cutoff" });
  cutoffLabel.textContent = "Same-day cutoff";
  const cutoffInput = el("input", { id: "cutoff", type: "time", step: "900", value: state.kitchen!.same_day_cutoff });
  cutoffInput.setAttribute("aria-label", "Same-day cutoff");
  const saveCutoffBtn = el("button", { class: "btn", onclick: () => void doSaveCutoff() });
  saveCutoffBtn.textContent = "Save cutoff";
  cutoffField.append(cutoffLabel, cutoffInput);
  cutoffSection.append(cutoffField, saveCutoffBtn);

  const cardsSection = el("section");
  cardsSection.append(el("h2", { text: "Rate cards" }));
  const cardsEl = el("div");

  const newSection = el("section");
  newSection.append(el("h2", { text: "New rate card" }));
  const form = el("form", { class: "stack", "aria-label": "New rate card" });
  const grid = el("div", { class: "form-grid" });
  const effectiveField = fieldWithInput("Effective from", "effective_from", "date");
  const tier1 = fieldWithInput("Tier 1 hourly rate", "tier1", "number", "32.00");
  const tier2 = fieldWithInput("Tier 2 hourly rate", "tier2", "number", "29.50");
  const tier3 = fieldWithInput("Tier 3 hourly rate", "tier3", "number", "27.25");
  const tier4 = fieldWithInput("Tier 4 hourly rate", "tier4", "number", "25.00");
  grid.append(effectiveField.field, tier1.field, tier2.field, tier3.field, tier4.field);
  const stationFields: Array<{ id: string; input: HTMLInputElement }> = [];
  for (const station of state.kitchen!.stations) {
    const f = fieldWithInput(`${station.name} surcharge`, `surcharge-${station.id}`, "number", "0.00");
    stationFields.push({ id: station.id, input: f.input });
    grid.append(f.field);
  }
  const windowField = fieldWithInput("Cancellation window (hours)", "window", "number", "72");
  const packField = fieldWithInput("Pack price", "pack_price", "number", "560.00");
  grid.append(windowField.field, packField.field);
  const addBtn = el("button", { class: "btn primary", type: "submit" });
  addBtn.textContent = "Add rate card";
  form.append(grid, addBtn);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void addCard();
  });
  newSection.append(form);

  wide.append(statusRegion, cutoffSection, cardsSection, newSection);
  cardsSection.append(cardsEl);
  container.append(wide);

  function fieldWithInput(labelText: string, id: string, type: string, value?: string): { field: HTMLElement; input: HTMLInputElement } {
    const field = el("div", { class: "field" });
    const label = el("label", { for: id });
    label.textContent = labelText;
    const input = el("input", { id, type, value: value ?? "" });
    input.setAttribute("aria-label", labelText);
    field.append(label, input);
    return { field, input };
  }

  async function doSaveCutoff(): Promise<void> {
    saveCutoffBtn.disabled = true;
    statusRegion.textContent = "Saving…";
    try {
      const value = cutoffInput.value.length === 5 ? `${cutoffInput.value}` : `0${cutoffInput.value}`;
      await api("PATCH", `/kitchens/${state.user!.kitchen_id}/settings`, { same_day_cutoff: value });
      statusRegion.textContent = `Same-day cutoff set to ${value}.`;
      state.kitchen!.same_day_cutoff = value;
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        statusRegion.textContent = "Enter a time on a quarter hour.";
      } else {
        statusRegion.textContent = error instanceof ApiError ? error.message : "Something went wrong.";
      }
    }
    saveCutoffBtn.disabled = false;
  }

  async function addCard(): Promise<void> {
    addBtn.disabled = true;
    statusRegion.textContent = "Saving rate card…";
    const surcharges: Record<string, number> = {};
    for (const station of stationFields) {
      surcharges[station.id] = Math.round(Number.parseFloat(station.input.value || "0") * 100);
    }
    const tiers = [tier1.input, tier2.input, tier3.input, tier4.input].map((input) => Math.round(Number.parseFloat(input.value || "0") * 100));
    try {
      const body = await api<{ rate_card: RateCard }>("POST", `/kitchens/${state.user!.kitchen_id}/rate-cards`, {
        effective_from: effectiveField.field.querySelector("input")!.value,
        tier_rates_cents: tiers,
        station_surcharges_cents: surcharges,
        cancellation_window_hours: Math.round(Number.parseInt(windowField.input.value || "0", 10)),
        pack_price_cents: Math.round(Number.parseFloat(packField.input.value || "0") * 100),
      });
      statusRegion.textContent = `Rate card added. It applies from ${body.rate_card.effective_from}.`;
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "rate_card_exists") {
        statusRegion.textContent = `A rate card already starts on ${effectiveField.field.querySelector("input")!.value}.`;
      } else if (error instanceof ApiError && error.status === 422) {
        const errors = error.extra.errors as Record<string, string> | undefined;
        const first = errors ? Object.values(errors)[0] : undefined;
        statusRegion.textContent = first ?? "Enter an amount in dollars and cents.";
      } else {
        statusRegion.textContent = error instanceof ApiError ? error.message : "Something went wrong.";
      }
    }
    addBtn.disabled = false;
  }

  async function refresh(): Promise<void> {
    const body = await api<{ rate_cards: RateCard[] }>("GET", `/kitchens/${state.user!.kitchen_id}/rate-cards`);
    const cards = body.rate_cards;
    const table = el("table", { class: "data card-table", "aria-label": "Rate cards" });
    const headRow = el("tr");
    for (const column of ["Effective from", "Tier 1", "Tier 2", "Tier 3", "Tier 4", "Cancellation window", "Pack price", "In force"]) {
      headRow.append(el("th", { text: column, class: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "Pack price"].includes(column) ? "num" : "" }));
    }
    const thead = el("thead");
    thead.append(headRow);
    table.append(thead);
    const tbody = el("tbody");
    for (const card of cards) {
      const row = el("tr");
      row.append(el("td", { text: card.effective_from, class: "num", "data-label": "Effective from" }));
      for (const tier of card.tier_rates_cents) {
        row.append(el("td", { text: fmtMoney(tier), class: "num", "data-label": "Tier" }));
      }
      row.append(el("td", { text: `${card.cancellation_window_hours} h`, class: "num", "data-label": "Cancellation window" }));
      row.append(el("td", { text: fmtMoney(card.pack_price_cents), class: "num", "data-label": "Pack price" }));
      row.append(el("td", { text: card.in_force ? "In force" : "\u2014", "data-label": "In force" }));
      tbody.append(row);
    }
    table.append(tbody);
    cardsEl.replaceChildren(table);
  }

  void refresh();
}
