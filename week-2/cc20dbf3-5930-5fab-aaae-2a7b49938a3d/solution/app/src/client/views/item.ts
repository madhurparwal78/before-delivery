import type { HoldCreated, Item, Lanes } from "../../shared/api.js";
import { addDays, isIsoDate, localDate } from "../../shared/calendar.js";
import { formatMoney } from "../../shared/money.js";
import { holdDateErrors, HORIZON_DAYS, MAX_SPAN_DAYS } from "../../shared/windows.js";
import { ApiFailure, get, messageOf, NetworkFailure, newKey, request } from "../api.js";
import { h, label, loadingLine, prefersReducedMotion, statusRegion, uid } from "../dom.js";
import { countDown, dropInto, dropThrough, showPendingBar } from "../lanedrop.js";
import { type LaneState, rangeFraction, renderLanes } from "../lanes.js";
import { calendar, currentUser, library } from "../session.js";
import { chip, freeChip, spanChip } from "../status.js";
import { fieldError, primaryButton, setPending, showFieldErrors } from "./forms.js";
import { notFoundView } from "./notfound.js";

/** Sends the hold once with a fresh key; if the network drops, retries once with the same key. */
async function sendHold(body: { item_id: string; start_date: string; end_date: string }): Promise<HoldCreated> {
  const key = newKey();
  try {
    return await request<HoldCreated>("POST", "/api/holds", { json: body, key });
  } catch (error) {
    if (!(error instanceof NetworkFailure)) throw error;
    return request<HoldCreated>("POST", "/api/holds", { json: body, key });
  }
}

export function itemView(root: HTMLElement, itemId: string): () => void {
  let active = true;
  const member = currentUser()?.role === "member";
  const today = localDate(new Date(), library().time_zone);

  const pickupId = uid("pickup");
  const returnId = uid("return");
  const pickup = h("input", { id: pickupId, type: "date", min: today, max: addDays(today, HORIZON_DAYS), required: true });
  const returnDate = h("input", { id: returnId, type: "date", min: today, max: addDays(today, HORIZON_DAYS + MAX_SPAN_DAYS), required: true });
  const pickupError = fieldError(pickup);
  const returnError = fieldError(returnDate);
  const holdButton = primaryButton("Hold a unit", { type: "submit", disabled: true });
  const claimResult = statusRegion("Claim result");
  const numeral = h("span", { class: "availability__numeral" }, "–");
  const numeralText = h("span", { class: "availability__text" }, "");
  const stack = h("div", { class: "lanes__stack" }, loadingLine());
  const card = h("div", { class: "item-card box" });

  const state: LaneState & { item: Item | null; holding: boolean; read: number } = {
    item: null,
    lanes: { item_id: itemId, from: today, to: today, unit_count: 0, units_free: null, lanes: [] },
    range: null,
    claimedUnitId: null,
    holding: false,
    read: 0,
  };

  const chosenRange = (): { start: string; end: string } | null => {
    const start = pickup.value;
    const end = returnDate.value;
    const errors = holdDateErrors(calendar(), today, start, end);
    const shown = { ...(start && errors.start_date ? { start_date: errors.start_date } : {}), ...(end && errors.end_date ? { end_date: errors.end_date } : {}) };
    showFieldErrors(shown, { start_date: pickupError, end_date: returnError });
    return Object.keys(errors).length === 0 ? { start, end } : null;
  };

  const showAvailability = () => {
    if (state.range && state.lanes.units_free !== null) {
      numeral.textContent = String(state.lanes.units_free);
      numeralText.textContent = `of ${state.lanes.unit_count} units free for these dates`;
    } else if (state.item) {
      numeral.textContent = String(state.item.units_free_today);
      numeralText.textContent = `of ${state.item.unit_count} units free today`;
    }
  };

  const readLanes = async (): Promise<void> => {
    const ticket = ++state.read;
    const query = state.range ? `?start=${state.range.start}&end=${state.range.end}` : "";
    const lanes = await get<Lanes>(`/api/items/${encodeURIComponent(itemId)}/lanes${query}`);
    if (!active || ticket !== state.read || state.holding) return;
    state.lanes = lanes;
    renderLanes(stack, state);
    showAvailability();
  };

  const datesChanged = () => {
    if (state.holding) return;
    returnDate.min = pickup.value && isIsoDate(pickup.value) ? pickup.value : today;
    state.range = chosenRange();
    holdButton.disabled = state.range === null;
    void readLanes();
  };
  for (const input of [pickup, returnDate]) {
    input.addEventListener("input", datesChanged);
    input.addEventListener("change", datesChanged);
  }

  const hold = async () => {
    const range = state.range;
    const item = state.item;
    if (state.holding || !range || !item) return;
    state.holding = true;
    setPending(holdButton, "Finding a free unit…");
    claimResult.textContent = "";
    const reduced = prefersReducedMotion();
    const bar = reduced ? null : showPendingBar(stack, rangeFraction(state.lanes, range));
    try {
      const created = await sendHold({ item_id: item.id, start_date: range.start, end_date: range.end });
      if (bar) await dropInto(stack, bar, created.hold.unit.lane_index);
      state.claimedUnitId = created.hold.unit.id;
      renderLanes(stack, state);
      const shown = Number(numeral.textContent);
      if (reduced || !Number.isInteger(shown)) numeral.textContent = String(created.units_free);
      else await countDown(numeral, shown, created.units_free);
      numeralText.textContent = `of ${created.unit_count} units free for these dates`;
      claimResult.textContent = `Held unit ${created.hold.unit.lane_index + 1} of ${created.unit_count}, ${created.units_free} units still free for these dates`;
    } catch (error) {
      if (bar) await dropThrough(stack, bar);
      claimResult.textContent = messageOf(error);
      if (error instanceof ApiFailure) showFieldErrors(error.fields, { start_date: pickupError, end_date: returnError });
    } finally {
      state.holding = false;
      setPending(holdButton, null);
    }
    if (active) await readLanes();
  };

  const dateForm = h(
    "form",
    {
      class: "hold-form",
      novalidate: true,
      onsubmit: (event: Event) => {
        event.preventDefault();
        void hold();
      },
    },
    h("div", { class: "field" }, h("label", { for: pickupId, class: "label" }, "Pickup date"), pickup, pickupError),
    h("div", { class: "field" }, h("label", { for: returnId, class: "label" }, "Return date"), returnDate, returnError),
    member ? holdButton : null,
    member ? claimResult : null,
  );

  const availability = h(
    "section",
    { class: "availability box", "aria-label": "Availability" },
    h("p", { class: "label" }, "Availability"),
    h("p", { class: "availability__figure" }, numeral, " ", numeralText),
  );

  const lanesRegion = h(
    "section",
    { class: "lanes box", "aria-labelledby": "lanes-title" },
    h("div", { class: "box__head" }, h("h2", { id: "lanes-title" }, "Unit lanes"), h("p", { class: "label lanes__legend" }, "Next 28 days")),
    stack,
    h(
      "ul",
      { class: "lanes__key", "aria-label": "Key" },
      h("li", null, freeChip(), " for your dates"),
      h("li", null, spanChip("held")),
      h("li", null, spanChip("out")),
      h("li", null, spanChip("overdue")),
      h("li", null, chip("Closed", "closed"), " Mondays and closure dates"),
    ),
  );

  const layout = h("div", { class: "grid item-layout" }, h("div", { class: "item-layout__card" }, card, dateForm, availability), lanesRegion);
  const waiting = loadingLine();
  root.append(waiting);

  void (async () => {
    try {
      const { item } = await get<{ item: Item }>(`/api/items/${encodeURIComponent(itemId)}`);
      if (!active) return;
      state.item = item;
      card.replaceChildren(
        h("p", { class: "label card__category" }, item.category),
        h("h1", { class: "item-card__title" }, item.name),
        h(
          "p",
          { class: "money-line" },
          item.deposit_cents > 0 ? [label("Deposit"), " ", h("span", { class: "money" }, formatMoney(item.deposit_cents))] : label("No deposit"),
        ),
        h("p", { class: "money-line" }, label("Replacement"), " ", h("span", { class: "money" }, formatMoney(item.replacement_cents))),
        h("p", { class: "money-line" }, label("Units"), " ", h("span", { class: "money" }, String(item.unit_count))),
      );
      document.title = `${item.name} · Shedline`;
      waiting.replaceWith(layout);
      showAvailability();
      await readLanes();
    } catch (error) {
      if (!active) return;
      if (error instanceof ApiFailure && error.status === 404) {
        root.replaceChildren();
        notFoundView(root);
        return;
      }
      waiting.replaceWith(h("p", { class: "result" }, messageOf(error)));
    }
  })();

  return () => {
    active = false;
  };
}
