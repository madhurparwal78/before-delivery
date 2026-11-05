// Breakdown: the cycles in breakdown, their bags, and each bag's checklist with flags for the coordinator.
import { api, errorCode, errorFields, NoResponse } from "../api.js";
import { openDialog } from "../dialog.js";
import { h, isBusy, reducedMotion, setBusy, setFieldError, uid } from "../dom.js";
import { announce, main, setNotice, useLive } from "../shell.js";

interface Item {
  product_id: string;
  case_name: string;
  units: number;
  packed: boolean;
  flagged_units: number;
}

interface Bag {
  household_code: string;
  household_name: string;
  packed: boolean;
  items: Item[];
}

interface Summary {
  id: string;
  name: string;
  status: string;
}

const say = (text: string) => announce("Bag updates", text);

export async function breakdownScreen(): Promise<() => void> {
  document.title = "Breakdown · Tally Split";
  useLive("Bag updates");
  main.replaceChildren(h("p", { class: "loading" }, "Loading bags"));
  const cycles: Summary[] = (await api("GET", "/api/cycles")).body.cycles.filter((c: Summary) => c.status === "breakdown");
  if (cycles.length === 0) {
    setNotice("breakdown", "No cycle is in breakdown yet.", "info");
    main.replaceChildren(h("section", { class: "panel" }, h("h1", {}, "Breakdown"), h("p", { class: "muted" }, "Bags appear here on pickup morning, once the coordinator starts breakdown.")));
    return () => setNotice("breakdown", null);
  }
  const cycleList = h("ul", { class: "cycle-picker", "aria-label": "Cycles in breakdown" });
  const bagsSlot = h("div", { class: "bags-slot" });
  main.replaceChildren(
    h("div", { class: "breakdown grid" },
      h("section", { class: "panel span-12" }, h("h1", {}, "Breakdown"), cycleList),
      bagsSlot),
  );

  async function showCycle(c: Summary, pickers: HTMLButtonElement[], picker: HTMLButtonElement): Promise<void> {
    pickers.forEach((p) => p.setAttribute("aria-pressed", String(p === picker)));
    const [bagsReply, detail] = await Promise.all([api("GET", `/api/cycles/${encodeURIComponent(c.id)}/bags`), api("GET", `/api/cycles/${encodeURIComponent(c.id)}`)]);
    if (bagsReply.status !== 200) return;
    const pickup: string = detail.body.pickup_display ?? "";
    let bags: Bag[] = bagsReply.body.bags;
    const bagList = h("ul", { class: "bag-list", "aria-label": "Bags" });
    const regionSlot = h("div", { class: "bag-region-slot" });
    const openers = new Map<string, HTMLLIElement>();

    function drawList(): void {
      bagList.replaceChildren(
        ...bags.map((bag) => {
          const button = h("button", { type: "button", class: "bag-button" }, `${bag.household_name} bag`);
          button.addEventListener("click", () => openBag(bag.household_code));
          const li = h("li", { class: `bag-item${bag.packed ? " is-packed" : ""}` }, button, bag.packed ? h("span", { class: "packed-word" }, "PACKED") : null);
          openers.set(bag.household_code, li);
          return li;
        }),
      );
    }

    function markPacked(bag: Bag): void {
      const li = openers.get(bag.household_code);
      if (!li) return;
      li.classList.toggle("is-packed", bag.packed);
      li.querySelector(".packed-word")?.remove();
      if (bag.packed) li.append(h("span", { class: "packed-word" }, "PACKED"));
    }

    function openBag(code: string): void {
      const bag = bags.find((b) => b.household_code === code)!;
      const rows = bag.items.map((item) => itemRow(bag, item));
      const region = h("section", { class: "panel bag-region", "aria-label": `${bag.household_name} bag` },
        h("h2", {}, `${bag.household_name} bag`),
        h("ul", { class: "checklist" }, ...rows));
      regionSlot.replaceChildren(region);
      if (!reducedMotion()) {
        region.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(.55,0,.15,1)" });
      }
      region.querySelector<HTMLInputElement>("input[type=checkbox]")?.focus();
    }

    function itemRow(bag: Bag, item: Item): HTMLElement {
      const box = h("input", { type: "checkbox", id: uid("item"), checked: item.packed });
      const text = `${item.units} of ${item.case_name}`;
      const flagInfo = h("span", { class: "flag-info" }, item.flagged_units ? `FLAGGED ${item.flagged_units}` : "");
      const flag = h("button", { type: "button", class: "button quiet", "aria-label": `Flag short: ${item.case_name}` }, "Flag short");
      box.addEventListener("click", (event) => {
        if (box.getAttribute("aria-disabled") === "true") event.preventDefault();
      });
      box.addEventListener("change", async () => {
        const packed = box.checked;
        box.setAttribute("aria-disabled", "true");
        try {
          const r = await api<Bag>("PUT", `/api/cycles/${encodeURIComponent(c.id)}/bags/${encodeURIComponent(bag.household_code)}/items/${encodeURIComponent(item.product_id)}`, { body: { packed } });
          box.removeAttribute("aria-disabled");
          if (r.status !== 200) {
            box.checked = !packed;
            say(errorCode(r) === "outside_pickup_window" ? `Outside the pickup window. Pickup is ${pickup}.` : (r.body as never as { error: { message: string } }).error.message);
            return;
          }
          bags = bags.map((b) => (b.household_code === r.body.household_code ? r.body : b));
          item.packed = packed;
          markPacked(r.body);
          const done = packed && r.body.packed ? ` ${bag.household_name} bag is packed.` : "";
          say(`${packed ? "Packed" : "Unpacked"} ${item.units} of ${item.case_name} for ${bag.household_name}.${done}`);
        } catch (error) {
          box.removeAttribute("aria-disabled");
          box.checked = !packed;
          if (!(error instanceof NoResponse)) throw error;
          say("Couldn't save that tick. Check your connection and try again.");
        }
      });
      flag.addEventListener("click", () => openFlag(bag, item, flag, flagInfo));
      return h("li", { class: "check-item" },
        h("label", { class: "check-row big", for: box.id }, box, h("span", { class: "check-name" }, text)),
        flagInfo,
        flag);
    }

    function openFlag(bag: Bag, item: Item, opener: HTMLButtonElement, info: HTMLElement): void {
      const units = h("input", { class: "input", type: "number", min: 1, step: 1, inputmode: "numeric", id: uid("missing"), "aria-label": "Units missing" });
      const error = h("p", { class: "field-error", id: uid("err"), hidden: true });
      const send = h("button", { type: "button", class: "button primary" }, "Flag");
      const cancel = h("button", { type: "button", class: "button quiet" }, "Cancel");
      const dialog = openDialog({
        title: "Flag short",
        body: [
          h("p", {}, `${item.case_name} for ${bag.household_name}: ${item.units} packed units expected.`),
          h("div", { class: "field" }, h("label", { class: "label", for: units.id }, "UNITS MISSING"), units, error),
        ],
        actions: [send, cancel],
        initialFocus: () => units,
        onClosed: () => opener.focus(),
      });
      cancel.addEventListener("click", () => dialog.close());
      const submit = async () => {
        if (isBusy(send)) return;
        setBusy(send, true, "Saving...", "Flag");
        const value = Number(units.value);
        try {
          const r = await api("POST", `/api/cycles/${encodeURIComponent(c.id)}/bags/${encodeURIComponent(bag.household_code)}/flags`, {
            body: { product_id: item.product_id, units: units.value.trim() !== "" && Number.isInteger(value) ? value : units.value },
          });
          setBusy(send, false, "Saving...", "Flag");
          if (r.status === 201) {
            item.flagged_units += value;
            info.textContent = `FLAGGED ${item.flagged_units}`;
            dialog.close();
            say(`Flagged ${value} missing of ${item.case_name} for the coordinator.`);
            return;
          }
          const text = errorCode(r) === "outside_pickup_window"
            ? `Outside the pickup window. Pickup is ${pickup}.`
            : errorFields(r).units ?? (r.body as { error: { message: string } }).error.message;
          setFieldError(units, error, text);
          say(text);
        } catch (e) {
          setBusy(send, false, "Saving...", "Flag");
          if (!(e instanceof NoResponse)) throw e;
          setFieldError(units, error, "Couldn't save the flag. Check your connection and try again.");
        }
      };
      send.addEventListener("click", () => void submit());
      units.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void submit();
        }
      });
    }

    drawList();
    bagsSlot.replaceChildren(
      h("section", { class: "panel span-12" }, h("h2", {}, `${c.name}: bags`), h("p", { class: "muted" }, `Pickup ${pickup}`), bagList),
      regionSlot,
    );
  }

  const pickers = cycles.map((c) => h("button", { type: "button", class: "button quiet", "aria-pressed": "false" }, c.name));
  pickers.forEach((picker, i) => picker.addEventListener("click", () => void showCycle(cycles[i]!, pickers, picker)));
  cycleList.replaceChildren(...pickers.map((p) => h("li", {}, p)));
  await showCycle(cycles[0]!, pickers, pickers[0]!);
  return () => setNotice("breakdown", null);
}
