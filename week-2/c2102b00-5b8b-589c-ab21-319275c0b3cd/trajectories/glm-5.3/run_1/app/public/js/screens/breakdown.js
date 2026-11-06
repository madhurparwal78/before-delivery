import { api } from "../api.js";
import { clear, el } from "../util.js";
import { announce } from "../live.js";
import { openDialog } from "../dialog.js";
import { ApiError, NetworkError } from "../api.js";
/** Breakdown: the bags list and each household's bag checklist. */
export async function renderBreakdown(page, me) {
    const notices = el("div", { class: "notices", role: "region", "aria-label": "Notices" });
    const cyclesWrap = el("div");
    const bagsWrap = el("div");
    const bagRegionWrap = el("div");
    page.append(el("h1", { text: "Breakdown" }), notices, cyclesWrap, el("h2", { text: "Bags" }), bagsWrap, bagRegionWrap);
    let cycleId = null;
    let bags = [];
    let pickupDisplay = null;
    let openBagCode = null;
    const bagOf = (code) => bags.find((b) => b.household_code === code);
    const drawCycleHeads = (cycles) => {
        const inBreakdown = cycles.filter((c) => c.status === "breakdown");
        clear(cyclesWrap);
        if (inBreakdown.length === 0) {
            cyclesWrap.append(el("div", { class: "empty-message", text: "No cycle is in breakdown yet." }));
            return;
        }
        const heads = inBreakdown.map((c) => el("h3", { text: c.name }));
        cyclesWrap.append(...heads);
        cycleId = inBreakdown[0].id;
    };
    const drawBagsList = () => {
        clear(bagsWrap);
        const list = el("ul", { class: "bag-list", "aria-label": "Bags" });
        for (const bag of bags) {
            const btn = el("button", {
                text: `${bag.household_name} bag${bag.packed ? " PACKED" : ""}`,
                onclick: () => {
                    openBagCode = bag.household_code;
                    drawBagRegion();
                    const first = bagRegionWrap.querySelector("input[type='checkbox']");
                    first?.focus();
                },
            });
            list.append(el("li", {}, btn));
        }
        bagsWrap.append(list);
    };
    const drawBagRegion = () => {
        clear(bagRegionWrap);
        const bag = bagOf(openBagCode ?? "");
        if (!bag)
            return;
        const region = el("section", { class: "section", role: "region", "aria-label": `${bag.household_name} bag` });
        region.append(el("h2", { text: `${bag.household_name} bag` }), el("p", { class: "label", text: bag.packed ? "PACKED" : "" }));
        const items = el("ul", { class: "bag-items" });
        for (const item of bag.items) {
            const checkbox = el("input", { type: "checkbox", "aria-label": `${item.units} of ${item.case_name}` });
            checkbox.checked = item.packed;
            checkbox.addEventListener("change", () => void toggle(item, checkbox));
            const flagBtn = el("button", {
                text: "Flag short",
                "aria-label": `Flag short: ${item.case_name}`,
                onclick: () => flagDialog(item, flagBtn),
            });
            items.append(el("li", {}, el("label", {}, checkbox, el("span", { text: `${item.units} of ${item.case_name}` })), flagBtn));
        }
        region.append(items);
        bagRegionWrap.append(region);
    };
    const toggle = async (item, checkbox) => {
        const requested = checkbox.checked;
        const bag = bagOf(openBagCode ?? "");
        if (!bag || !cycleId)
            return;
        checkbox.setAttribute("disabled", "");
        try {
            const { data } = await api(`/api/cycles/${cycleId}/bags/${encodeURIComponent(bag.household_code)}/items/${item.product_id}`, { method: "PUT", body: JSON.stringify({ packed: requested }) });
            replaceBag(data);
            checkbox.checked = data.items.find((i) => i.product_id === item.product_id)?.packed ?? requested;
            checkbox.removeAttribute("disabled");
            announce("bag", requested
                ? `Packed ${item.units} of ${item.case_name} for ${bag.household_name}.`
                : `Unpacked ${item.units} of ${item.case_name} for ${bag.household_name}.`);
            if (data.packed) {
                announce("bag", `${bag.household_name} bag is packed.`);
            }
        }
        catch (e) {
            checkbox.checked = !requested;
            checkbox.removeAttribute("disabled");
            if (e instanceof ApiError && e.code === "outside_pickup_window") {
                announce("bag", `Outside the pickup window. Pickup is ${pickupDisplay}.`);
            }
            else if (e instanceof ApiError) {
                announce("bag", e.message);
            }
            else if (e instanceof NetworkError) {
                announce("bag", "Check your connection and try again.");
            }
        }
    };
    const replaceBag = (bag) => {
        const idx = bags.findIndex((b) => b.household_code === bag.household_code);
        if (idx >= 0)
            bags[idx] = bag;
        else
            bags.push(bag);
        drawBagsList();
        const packedLabel = bagRegionWrap.querySelector("section > p.label");
        if (packedLabel)
            packedLabel.textContent = bag.packed ? "PACKED" : "";
    };
    const flagDialog = (item, opener) => {
        openDialog({
            label: "Flag short",
            returnFocusTo: opener,
            onClose: () => { },
            build: (body, close) => {
                const input = el("input", { type: "number", value: "1", min: "1", max: String(item.units) });
                input.setAttribute("aria-label", "Units missing");
                const error = el("div", { class: "field-error", hidden: true });
                const flagBtn = el("button", { text: "Flag" });
                const cancel = el("button", { text: "Cancel" });
                body.append(el("h2", { text: "Flag short" }), el("div", { class: "field" }, el("label", { class: "label", text: "UNITS MISSING" }), input, error), el("div", { class: "actions" }, cancel, flagBtn));
                cancel.addEventListener("click", close);
                flagBtn.addEventListener("click", async () => {
                    const units = parseInt(input.value, 10);
                    const bag = bagOf(openBagCode ?? "");
                    if (!bag || !cycleId)
                        return;
                    flagBtn.setAttribute("disabled", "");
                    flagBtn.textContent = "Saving...";
                    try {
                        await api(`/api/cycles/${cycleId}/bags/${encodeURIComponent(bag.household_code)}/flags`, {
                            method: "POST",
                            body: JSON.stringify({ product_id: item.product_id, units }),
                        });
                        announce("bag", `Flagged ${units} missing of ${item.case_name} for the coordinator.`);
                        close();
                    }
                    catch (e) {
                        flagBtn.removeAttribute("disabled");
                        flagBtn.textContent = "Flag";
                        error.hidden = false;
                        if (e instanceof ApiError && e.code === "outside_pickup_window") {
                            error.textContent = `Outside the pickup window. Pickup is ${pickupDisplay}.`;
                        }
                        else if (e instanceof ApiError && e.code === "validation") {
                            error.textContent = `Enter 1 to ${item.units} units.`;
                        }
                        else {
                            error.textContent = "Check your connection and try again.";
                        }
                    }
                });
                input.focus();
            },
        });
    };
    const load = async () => {
        try {
            const { data } = await api("/api/cycles");
            const inBreakdown = data.cycles.filter((c) => c.status === "breakdown");
            if (inBreakdown.length === 0) {
                clear(cyclesWrap);
                clear(bagsWrap);
                clear(bagRegionWrap);
                cyclesWrap.append(el("div", { class: "empty-message", text: "No cycle is in breakdown yet." }));
                return;
            }
            cycleId = inBreakdown[0].id;
            const cycleResp = await api(`/api/cycles/${cycleId}`);
            pickupDisplay = cycleResp.data.pickup_display;
            const { data: bagData } = await api(`/api/cycles/${cycleId}/bags`);
            bags = bagData.bags;
            clear(cyclesWrap);
            cyclesWrap.append(el("h2", { text: cycleResp.data.name }));
            drawBagsList();
            if (openBagCode && bagOf(openBagCode))
                drawBagRegion();
        }
        catch (e) {
            if (!(e instanceof ApiError))
                return;
            if (e.code === "wrong_cycle_state") {
                clear(cyclesWrap);
                cyclesWrap.append(el("div", { class: "empty-message", text: "No cycle is in breakdown yet." }));
            }
        }
    };
    await load();
    const timer = setInterval(() => {
        if (!document.body.contains(cyclesWrap)) {
            clearInterval(timer);
            return;
        }
        void load();
    }, 10000);
}
