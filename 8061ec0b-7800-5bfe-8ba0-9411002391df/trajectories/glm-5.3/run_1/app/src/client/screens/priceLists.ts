// Price lists (DP-23, DP-26, DP-71).
import { api, ApiError } from "../api.js";
import { h, statusRegion, focusStatus, clearChildren } from "../ui/dom.js";
import { openDialog } from "../ui/dialog.js";
import { moneyInput, parseCents, parsePercentToBp, formatTaxPercent } from "../format.js";
import { INSTRUMENT_NAMES, type InstrumentType } from "../../shared/domain.js";
import type { RenderContext } from "../router.js";
import { markFields } from "./register.js";

interface PriceListRow {
  id: string;
  effective_date: string;
  created_at: string;
  withdrawn_at: string | null;
  tax_rate_bp: number;
  items: { instrument_type: string; base_rent_cents: number; waiver_cents: number; purchase_price_cents: number }[];
  tiers: { from_month: number; to_month: number | null; percent: number; name: string; label: string }[];
  standing?: string;
}

export async function renderPriceLists(ctx: RenderContext): Promise<void> {
  ctx.root.appendChild(h("h1", { text: "Price lists" }));
  const status = statusRegion("Price list status");
  const tableWrap = h("div", { class: "price-lists-wrap" });
  const formWrap = h("div", {});

  async function load(): Promise<void> {
    const data = await api<{ price_lists: PriceListRow[] }>("GET", "/api/price-lists");
    const current = await api<{ price_list: PriceListRow }>("GET", "/api/price-lists/current");
    clearChildren(tableWrap);
    tableWrap.appendChild(buildTable(data.price_lists));
    clearChildren(formWrap);
    formWrap.appendChild(buildForm(current.price_list));
  }

  function buildTable(lists: PriceListRow[]): HTMLElement {
    const table = h("table", { class: "register-table price-table", "aria-label": "Price lists" });
    const headRow = h("tr", {});
    headRow.append(
      h("th", { scope: "col", text: "ID" }),
      h("th", { scope: "col", text: "Effective date" }),
      h("th", { scope: "col", text: "Tax rate" }),
      h("th", { scope: "col", text: "Status" }),
      ...Object.keys(INSTRUMENT_NAMES).map((type) => h("th", { scope: "col", text: `${type[0].toUpperCase()}${type.slice(1)} rent` }))
    );
    table.appendChild(h("thead", {}, headRow));
    const tbody = h("tbody", {});
    for (const list of lists) {
      const tr = h("tr", {});
      tr.append(
        h("td", { class: "mono", text: list.id }),
        h("td", { class: "mono", text: list.effective_date }),
        h("td", { class: "mono", text: formatTaxPercent(list.tax_rate_bp) }),
        h("td", { text: list.standing ?? standingOf(list) })
      );
      for (const type of Object.keys(INSTRUMENT_NAMES)) {
        const item = list.items.find((i) => i.instrument_type === type);
        tr.appendChild(h("td", { class: "mono", text: item ? moneyInput(item.base_rent_cents) : "—" }));
      }
      if ((list.standing ?? standingOf(list)) === "Scheduled") {
        const withdrawCell = h("td", {});
        withdrawCell.appendChild(
          h("button", {
            class: "btn btn-danger",
            text: `Withdraw ${list.id}`,
            onclick: (event: MouseEvent) => openWithdraw(event.currentTarget as HTMLElement, list),
          })
        );
        tr.appendChild(withdrawCell);
      } else {
        tr.appendChild(h("td", {}));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  function standingOf(list: PriceListRow): string {
    if (list.withdrawn_at) return "Withdrawn";
    return "—";
  }

  function openWithdraw(opener: HTMLElement, list: PriceListRow): void {
    openDialog({
      name: "Confirm withdrawal",
      opener,
      build(body, close) {
        body.appendChild(h("h2", { text: "Confirm withdrawal" }));
        body.appendChild(
          h("p", {
            text: `Withdraw ${list.id} before it takes effect on ${list.effective_date}? Contracts and reservations keep the terms in force without it.`,
          })
        );
        const confirm = h("button", {
          class: "btn btn-danger",
          text: "Withdraw price list",
          onclick: async () => {
            confirm.disabled = true;
            status.textContent = "Withdrawing…";
            try {
              await api("POST", `/api/price-lists/${list.id}/withdraw`, {});
              close();
              status.textContent = `Price list ${list.id} withdrawn before it took effect.`;
              await load();
              focusStatus("Price list status");
            } catch (err) {
              confirm.disabled = false;
              if (err instanceof ApiError && err.code === "price_list_in_force") {
                status.textContent = `${list.id} is already in force and can't be withdrawn.`;
              } else if (err instanceof ApiError && err.code === "price_list_withdrawn") {
                status.textContent = `${list.id} was already withdrawn.`;
              } else {
                status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
              }
              close();
              focusStatus("Price list status");
            }
          },
        });
        const cancel = h("button", { class: "btn btn-secondary", text: "Cancel", onclick: close });
        body.appendChild(h("div", { class: "dialog-actions" }, cancel, confirm));
      },
    });
  }

  // The form opens filled with the values and tiers of the version in force
  // today, with Effective date empty.
  function buildForm(current: PriceListRow): HTMLElement {
    const form = h("form", { "aria-label": "New price list", class: "price-form" });
    form.appendChild(h("h2", { text: "New price list" }));

    const effective = h("input", { class: "input mono", "aria-label": "Effective date", type: "text", placeholder: "YYYY-MM-DD" });
    const effectiveField = fieldRow("Effective date", effective, "effective_date");
    const taxRate = h("input", { class: "input mono", "aria-label": "Sales tax rate", type: "text", placeholder: "8.25", value: (current.tax_rate_bp / 100).toFixed(2) });
    const taxField = fieldRow("Sales tax rate", taxRate, "tax_rate_bp");

    const itemsFields: { type: InstrumentType; rent: HTMLInputElement; waiver: HTMLInputElement; price: HTMLInputElement; fields: HTMLElement[] }[] = [];
    const itemsWrap = h("div", { class: "form-grid" });
    for (const type of Object.keys(INSTRUMENT_NAMES) as InstrumentType[]) {
      const item = current.items.find((i) => i.instrument_type === type);
      const rent = h("input", { class: "input mono", "aria-label": `${INSTRUMENT_NAMES[type]} monthly rent`, value: item ? moneyInput(item.base_rent_cents) : "" });
      const waiver = h("input", { class: "input mono", "aria-label": `${INSTRUMENT_NAMES[type]} waiver`, value: item ? moneyInput(item.waiver_cents) : "" });
      const price = h("input", { class: "input mono", "aria-label": `${INSTRUMENT_NAMES[type]} purchase price`, value: item ? moneyInput(item.purchase_price_cents) : "" });
      const rentField = fieldRow(`${INSTRUMENT_NAMES[type]} monthly rent`, rent, `items.${type}.base_rent_cents`);
      const waiverField = fieldRow(`${INSTRUMENT_NAMES[type]} waiver`, waiver, `items.${type}.waiver_cents`);
      const priceField = fieldRow(`${INSTRUMENT_NAMES[type]} purchase price`, price, `items.${type}.purchase_price_cents`);
      itemsWrap.append(rentField, waiverField, priceField);
      itemsFields.push({ type, rent, waiver, price, fields: [rentField, waiverField, priceField] });
    }

    const tiersWrap = h("div", { class: "tiers-wrap" });
    const tierRows: { name: HTMLInputElement; from: HTMLInputElement; to: HTMLInputElement; percent: HTMLInputElement; fields: HTMLElement[] }[] = [];
    const addTierRow = (tier?: PriceListRow["tiers"][number]): void => {
      const idx = tierRows.length;
      const name = h("input", { class: "input", "aria-label": `Tier ${idx + 1} name`, value: tier?.name ?? "" });
      const from = h("input", { class: "input mono", "aria-label": `Tier ${idx + 1} from month`, value: tier ? String(tier.from_month) : "" });
      const to = h("input", { class: "input mono", "aria-label": `Tier ${idx + 1} to month`, value: tier?.to_month === null || tier?.to_month === undefined ? "" : String(tier.to_month) });
      const percent = h("input", { class: "input mono", "aria-label": `Tier ${idx + 1} percent`, value: tier ? String(tier.percent) : "" });
      const nameField = fieldRow(`Tier ${idx + 1} name`, name, `tiers.${idx}.name`);
      const fromField = fieldRow(`Tier ${idx + 1} from month`, from, `tiers.${idx}.from_month`);
      const toField = fieldRow(`Tier ${idx + 1} to month`, to, `tiers.${idx}.to_month`);
      const percentField = fieldRow(`Tier ${idx + 1} percent`, percent, `tiers.${idx}.percent`);
      tiersWrap.append(h("div", { class: "tier-row" }, nameField, fromField, toField, percentField));
      tierRows.push({ name, from, to, percent, fields: [nameField, fromField, toField, percentField] });
    };
    for (const tier of current.tiers) addTierRow(tier);

    const addTier = h("button", {
      class: "btn btn-secondary",
      type: "button",
      text: "Add tier",
      onclick: () => addTierRow(),
    });

    const publish = h("button", {
      class: "btn btn-primary",
      type: "submit",
      text: "Publish price list",
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      publish.disabled = true;
      status.textContent = "Publishing…";
      try {
        const result = await api<{ price_list: PriceListRow }>("POST", "/api/price-lists", {
          effective_date: effective.value.trim() || null,
          tax_rate_bp: parsePercentToBp(taxRate.value),
          items: itemsFields.map((entry) => ({
            instrument_type: entry.type,
            base_rent_cents: parseCents(entry.rent.value),
            waiver_cents: parseCents(entry.waiver.value),
            purchase_price_cents: parseCents(entry.price.value),
          })),
          tiers: tierRows.map((row) => ({
            name: row.name.value.trim() || null,
            from_month: row.from.value.trim() === "" ? null : Number(row.from.value),
            to_month: row.to.value.trim() === "" ? null : Number(row.to.value),
            percent: row.percent.value.trim() === "" ? null : Number(row.percent.value),
          })),
        });
        status.textContent = `Price list ${result.price_list.id} takes effect ${result.price_list.effective_date}. Contracts signed before then keep their terms.`;
        await load();
        focusStatus("Price list status");
      } catch (err) {
        if (err instanceof ApiError && err.status === 422 && err.fields) {
          const fields = [...itemsFields.flatMap((i) => i.fields), ...tierRows.flatMap((t) => t.fields)];
          markFields([effectiveField, taxField, ...fields], err.fields, []);
        } else {
          status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
        }
        focusStatus("Price list status");
      } finally {
        publish.disabled = false;
      }
    });

    form.append(effectiveField, taxField, itemsWrap, tiersWrap, addTier, publish);
    return form;
  }

  ctx.root.append(tableWrap, formWrap, status);
  await load();
}

function fieldRow(label: string, input: HTMLElement, key: string): HTMLElement {
  const message = h("span", { class: "field-message", id: `msg-${key.replace(/\./g, "-")}` });
  input.setAttribute("aria-describedby", `msg-${key.replace(/\./g, "-")}`);
  return h("label", { class: "field field-cell", "data-field": key },
    h("span", { class: "field-label", text: label }),
    input,
    message
  );
}
