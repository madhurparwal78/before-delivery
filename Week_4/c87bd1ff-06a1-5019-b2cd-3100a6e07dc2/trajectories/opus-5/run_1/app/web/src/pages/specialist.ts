import { get, request } from "../api.js";
import { data, type Screen } from "../app.js";
import { copy } from "../copy.js";
import { clear, el, field, setFieldError } from "../dom.js";
import type { ConsignorLot, Sale } from "../types.js";

const portraitOptions: [string, string][] = [
  ["chronograph", "Chronograph dial"],
  ["rangefinder", "Pocket rangefinder"],
  ["diver", "Diver's bezel"],
  ["twin_lens", "Twin-lens reflex"],
  ["dress", "Dress watch"],
  ["bellows", "Folding bellows camera"],
];

const estimateFields: [string, string][] = [
  ["estimate_low", "Low estimate"],
  ["estimate_high", "High estimate"],
  ["opening_bid", "Opening bid"],
  ["reserve", "Reserve"],
];

const SALE_ENDS_FORM = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/**
 * rotterdamToUTC reads a Rotterdam local time typed as YYYY-MM-DD HH:MM and
 * returns the same moment in UTC, or null when it is not a real date.
 */
const rotterdamToUTC = (typed: string): string | null => {
  const match = SALE_ENDS_FORM.exec(typed.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as unknown as number[];
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(guess));
  const zone = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const offset = /GMT([+-])(\d{2}):(\d{2})/.exec(zone);
  const sign = offset && offset[1] === "-" ? -1 : 1;
  const offsetMinutes = offset ? sign * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
  const moment = new Date(guess - offsetMinutes * 60000);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return moment.toISOString().replace(/\.\d{3}Z$/, "Z");
};

/** The specialist's desk: Intake, Estimate and Sale order. */
export const specialistScreen: Screen = (app) => {
  let intake = data<ConsignorLot[]>(app, "intake", []);
  let estimated = data<ConsignorLot[]>(app, "estimated", []);
  let placed = data<ConsignorLot[]>(app, "placed", []);
  let sales = data<Sale[]>(app, "sales", []);
  let selected: ConsignorLot | null = null;
  let chosenSale = "";

  const intakePanel = el("section", { class: "panel", role: "region", "aria-label": "Intake" });
  const estimatePanel = el("section", { class: "panel", role: "region", "aria-label": "Estimate" });
  const orderPanel = el("section", { class: "panel", role: "region", "aria-label": "Sale order" });

  clear(app.root);
  app.root.className = "page page-specialist";
  app.root.append(
    el("h1", { class: "desk-heading", text: "SPECIALIST DESK" }),
    el("div", { class: "desk-regions" }, [intakePanel, estimatePanel, orderPanel]),
  );

  const inputs: Record<string, HTMLInputElement> = {};
  const conditionInput = el("textarea", { rows: "4" });
  const portraitSelect = el("select", { "aria-label": "Portrait" });
  portraitSelect.append(el("option", { value: "", text: "Choose a portrait" }));
  for (const [value, label] of portraitOptions) {
    portraitSelect.append(el("option", { value, text: label }));
  }
  const saveButton = el("button", { type: "button", text: "Save estimate" });
  const estimateNote = el("p", { class: "form-note" });

  const titleInput = el("input", { type: "text" });
  const endsInput = el("input", { type: "text", placeholder: "2026-11-12 20:00" });
  const firstLotInput = el("input", { type: "text", inputmode: "numeric", value: "201" });
  const createButton = el("button", { type: "button", text: "Create sale" });
  const saleSelect = el("select", { "aria-label": "Sale" });
  const orderList = el("ul", { class: "order-list", "aria-label": "Catalogue order" });
  const addHolder = el("div", { class: "order-add" });
  const publishButton = el("button", { type: "button", class: "action", text: "Publish sale" });
  const saleNote = el("p", { class: "form-note" });

  const paintIntake = () => {
    clear(intakePanel);
    intakePanel.append(el("h2", { text: "Intake" }));
    for (const lot of [...intake, ...estimated]) {
      const button = el("button", {
        type: "button",
        "aria-label": `Estimate ${lot.title}`,
        text: `${lot.title} · ${lot.state}`,
      });
      button.addEventListener("click", () => {
        selected = lot;
        paintEstimate();
      });
      intakePanel.append(button);
    }
  };

  const paintEstimate = () => {
    clear(estimatePanel);
    estimatePanel.append(el("h2", { text: "Estimate" }));
    for (const [key, label] of estimateFields) {
      if (!inputs[key]) {
        inputs[key] = el("input", { type: "text", class: "amounts", inputmode: "numeric" });
      }
      estimatePanel.append(field(label, inputs[key], `${key}-error`));
    }
    estimatePanel.append(
      field("Condition notes", conditionInput, "condition-error"),
      el("label", { class: "field" }, [
        el("span", { class: "field-label", text: "Portrait" }),
        portraitSelect,
        el("p", { class: "field-error", id: "portrait-error" }),
      ]),
      saveButton,
      estimateNote,
    );
    if (selected) {
      inputs.estimate_low.value = selected.estimate_low === null ? "" : String(selected.estimate_low);
      inputs.estimate_high.value =
        selected.estimate_high === null ? "" : String(selected.estimate_high);
      inputs.opening_bid.value = selected.opening_bid === null ? "" : String(selected.opening_bid);
      inputs.reserve.value = selected.reserve === null ? "" : String(selected.reserve);
      conditionInput.value = selected.condition;
      portraitSelect.value = selected.portrait ?? "";
    }
  };

  const numberOrText = (raw: string): number | string =>
    /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw.trim();

  saveButton.addEventListener("click", async () => {
    if (!selected) return;
    for (const [key] of estimateFields) setFieldError(inputs[key], `${key}-error`, "");
    setFieldError(conditionInput, "condition-error", "");
    setFieldError(portraitSelect, "portrait-error", "");
    saveButton.disabled = true;
    const result = await request<{ lot: ConsignorLot }>(
      "PUT",
      `/api/desk/lots/${encodeURIComponent(selected.id)}/estimate`,
      {
        estimate_low: numberOrText(inputs.estimate_low.value),
        estimate_high: numberOrText(inputs.estimate_high.value),
        opening_bid: numberOrText(inputs.opening_bid.value),
        reserve: numberOrText(inputs.reserve.value),
        condition: conditionInput.value,
        portrait: portraitSelect.value,
      },
    );
    saveButton.disabled = false;
    if (result.status === 200 && result.body.lot) {
      estimateNote.textContent = copy.estimateSaved(result.body.lot.title);
      app.say.result(estimateNote.textContent);
      selected = result.body.lot;
      await refresh();
      return;
    }
    const fields = result.body.fields ?? {};
    for (const [key] of estimateFields) {
      if (fields[key]) setFieldError(inputs[key], `${key}-error`, fields[key]);
    }
    if (fields.condition) setFieldError(conditionInput, "condition-error", fields.condition);
    if (fields.portrait) setFieldError(portraitSelect, "portrait-error", fields.portrait);
    estimateNote.textContent =
      Object.keys(fields).length === 0 ? (result.body.message ?? copy.serverFailure) : "";
    app.say.result(estimateNote.textContent || Object.values(fields).join(" "));
  });

  const saleLots = (): ConsignorLot[] =>
    placed
      .filter((lot) => lot.sale_id === chosenSale)
      .sort((a, b) => (a.lot_number ?? 0) - (b.lot_number ?? 0));

  const paintOrder = () => {
    clear(orderPanel);
    orderPanel.append(
      el("h2", { text: "Sale order" }),
      field("Sale title", titleInput, "sale-title-error"),
      field("Sale ends", endsInput, "sale-ends-error"),
      field("First lot number", firstLotInput, "first-lot-error"),
      createButton,
      el("label", { class: "field" }, [
        el("span", { class: "field-label", text: "Sale" }),
        saleSelect,
      ]),
      orderList,
      addHolder,
      publishButton,
      saleNote,
    );
    clear(saleSelect);
    for (const sale of sales) {
      saleSelect.append(el("option", { value: sale.id, text: sale.title }));
    }
    if (!sales.some((sale) => sale.id === chosenSale)) {
      chosenSale = sales.length > 0 ? sales[0].id : "";
    }
    saleSelect.value = chosenSale;

    const ordered = saleLots();
    clear(orderList);
    ordered.forEach((lot, index) => {
      const up = el("button", { type: "button", "aria-label": `Move ${lot.title} up`, text: "Up" });
      const down = el("button", {
        type: "button",
        "aria-label": `Move ${lot.title} down`,
        text: "Down",
      });
      const remove = el("button", {
        type: "button",
        "aria-label": `Remove ${lot.title} from sale`,
        text: "Remove",
      });
      up.addEventListener("click", () => void reorder(swap(ordered, index, index - 1)));
      down.addEventListener("click", () => void reorder(swap(ordered, index, index + 1)));
      remove.addEventListener("click", () =>
        void reorder(ordered.filter((other) => other.id !== lot.id)),
      );
      orderList.append(el("li", {}, [el("span", { text: lot.title }), up, down, remove]));
    });
    clear(addHolder);
    for (const lot of estimated) {
      const add = el("button", {
        type: "button",
        "aria-label": `Add ${lot.title} to sale`,
        text: `Add ${lot.title}`,
      });
      add.addEventListener("click", () => void reorder([...ordered, lot]));
      addHolder.append(add);
    }
  };

  const swap = (list: ConsignorLot[], from: number, to: number): ConsignorLot[] => {
    if (to < 0 || to >= list.length) return list;
    const copyList = [...list];
    [copyList[from], copyList[to]] = [copyList[to], copyList[from]];
    return copyList;
  };

  const reorder = async (ordered: ConsignorLot[]) => {
    if (!chosenSale) return;
    const result = await request(
      "PUT",
      `/api/desk/sales/${encodeURIComponent(chosenSale)}/lots`,
      { lot_ids: ordered.map((lot) => lot.id) },
    );
    if (result.status !== 200) {
      saleNote.textContent = result.body.message ?? copy.serverFailure;
      app.say.result(saleNote.textContent);
    }
    await refresh();
  };

  saleSelect.addEventListener("change", () => {
    chosenSale = saleSelect.value;
    paintOrder();
  });

  createButton.addEventListener("click", async () => {
    setFieldError(titleInput, "sale-title-error", "");
    setFieldError(endsInput, "sale-ends-error", "");
    setFieldError(firstLotInput, "first-lot-error", "");
    const endsAt = rotterdamToUTC(endsInput.value);
    if (endsAt === null) {
      setFieldError(endsInput, "sale-ends-error", copy.saleEndsForm);
      app.say.result(copy.saleEndsForm);
      return;
    }
    createButton.disabled = true;
    const result = await request<{ sale: Sale }>("POST", "/api/desk/sales", {
      title: titleInput.value,
      ends_at: endsAt,
      first_lot_number: /^\d+$/.test(firstLotInput.value.trim())
        ? Number(firstLotInput.value.trim())
        : firstLotInput.value.trim(),
    });
    createButton.disabled = false;
    if (result.status === 201 && result.body.sale) {
      saleNote.textContent = copy.saleCreated(result.body.sale.title);
      app.say.result(saleNote.textContent);
      chosenSale = result.body.sale.id;
      await refresh();
      return;
    }
    const fields = result.body.fields ?? {};
    if (fields.title) setFieldError(titleInput, "sale-title-error", fields.title);
    if (fields.ends_at) setFieldError(endsInput, "sale-ends-error", fields.ends_at);
    if (fields.first_lot_number) {
      setFieldError(firstLotInput, "first-lot-error", fields.first_lot_number);
    }
    saleNote.textContent =
      Object.keys(fields).length === 0 ? (result.body.message ?? copy.serverFailure) : "";
    app.say.result(saleNote.textContent || Object.values(fields).join(" "));
  });

  publishButton.addEventListener("click", async () => {
    if (!chosenSale) return;
    publishButton.disabled = true;
    const result = await request<{ lots: ConsignorLot[] }>(
      "POST",
      `/api/desk/sales/${encodeURIComponent(chosenSale)}/publish`,
    );
    publishButton.disabled = false;
    if (result.status === 200) {
      saleNote.textContent = copy.salePublished(result.body.lots?.length ?? 0);
    } else {
      const fields = result.body.fields ?? {};
      saleNote.textContent =
        fields.ends_at ?? fields.lots ?? result.body.message ?? copy.serverFailure;
    }
    app.say.result(saleNote.textContent);
    await refresh();
  });

  const refresh = async () => {
    const [intakeResult, estimatedResult, placedResult, salesResult] = await Promise.all([
      get<{ lots: ConsignorLot[] }>("/api/desk/lots?state=intake"),
      get<{ lots: ConsignorLot[] }>("/api/desk/lots?state=estimated"),
      get<{ lots: ConsignorLot[] }>("/api/desk/lots?state=placed"),
      get<{ sales: Sale[] }>("/api/desk/sales"),
    ]);
    if (intakeResult.status === 200) intake = intakeResult.body.lots ?? [];
    if (estimatedResult.status === 200) estimated = estimatedResult.body.lots ?? [];
    if (placedResult.status === 200) placed = placedResult.body.lots ?? [];
    if (salesResult.status === 200) sales = salesResult.body.sales ?? [];
    paintIntake();
    paintOrder();
  };

  paintIntake();
  paintEstimate();
  paintOrder();
};
