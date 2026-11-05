import { api, ApiError, newIdempotencyKey, NetworkError } from "../api.js";
import { clear, el } from "../util.js";
import { announce } from "../live.js";
import { openDialog } from "../dialog.js";
import { clubLocalText } from "../clubs.js";
const apiLocal = (text) => text.trim().replace(" ", "T");
import { clubInfo } from "../session.js";
/** Draft screen (new and saved) and the live coordinator cycle view. */
export async function renderCoordinatorCycle(page, me, cycleId) {
    void me;
    if (cycleId === null) {
        await renderNewDraft(page);
        return;
    }
    const cycleResp = await api(`/api/cycles/${cycleId}`);
    if (cycleResp.data.status === "draft") {
        await renderDraft(page, cycleResp.data, cycleResp.etag);
        return;
    }
    await renderLiveCycle(page, cycleResp.data, cycleResp.etag);
}
// ---------- new draft ----------
async function renderNewDraft(page) {
    const { data: catalog } = await api("/api/catalog");
    const problems = el("div", { class: "problem-summary", role: "region", hidden: true, "aria-label": "Problems with this cycle" });
    const name = el("input", { type: "text" });
    name.setAttribute("aria-label", "Cycle name");
    const cutoff = el("input", { type: "text" });
    cutoff.setAttribute("aria-label", "Cutoff (club time)");
    const pickupStart = el("input", { type: "text" });
    pickupStart.setAttribute("aria-label", "Pickup starts (club time)");
    const pickupEnd = el("input", { type: "text" });
    pickupEnd.setAttribute("aria-label", "Pickup ends (club time)");
    const checks = el("div", { class: "checks" });
    const fieldErrors = new Map();
    const form = el("div", { class: "form-panel" }, fieldBlock("CYCLE NAME", name, "name"), fieldBlock("CUTOFF (CLUB TIME)", cutoff, "cutoff_local"), fieldBlock("PICKUP STARTS (CLUB TIME)", pickupStart, "pickup_start_local"), fieldBlock("PICKUP ENDS (CLUB TIME)", pickupEnd, "pickup_end_local"), el("div", { class: "field" }, el("span", { class: "label", text: "CASES" }), checks, fieldErrorEl("product_ids")));
    const save = el("button", { text: "Save draft" });
    page.append(el("h1", { text: "New cycle" }), problems, form, el("div", { class: "actions" }, save));
    function fieldErrorEl(field) {
        const err = el("div", { class: "field-error", hidden: true });
        err.setAttribute("data-field", field);
        fieldErrors.set(field, err);
        return err;
    }
    function fieldBlock(labelText, input, field) {
        return el("div", { class: "field" }, el("label", { class: "label", text: labelText }), input, fieldErrorEl(field));
    }
    for (const p of catalog.products) {
        const box = el("input", { type: "checkbox" });
        box.setAttribute("aria-label", p.case_name);
        box.dataset.productId = p.id;
        checks.append(el("div", { class: "check-line" }, box, el("label", { text: `${p.case_name} — pack of ${p.pack}` })));
    }
    save.addEventListener("click", () => void doSave());
    for (const input of [name, cutoff, pickupStart, pickupEnd]) {
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                void doSave();
            }
        });
    }
    async function doSave() {
        if (save.hasAttribute("disabled"))
            return;
        save.setAttribute("disabled", "");
        save.textContent = "Saving...";
        const body = { name: name.value };
        if (cutoff.value)
            body.cutoff_local = apiLocal(cutoff.value);
        if (pickupStart.value)
            body.pickup_start_local = apiLocal(pickupStart.value);
        if (pickupEnd.value)
            body.pickup_end_local = apiLocal(pickupEnd.value);
        const productIds = [...checks.querySelectorAll("input:checked")].map((c) => c.dataset.productId);
        if (productIds.length > 0)
            body.product_ids = productIds;
        try {
            const { data } = await api("/api/cycles", { method: "POST", body: JSON.stringify(body) });
            announce("coordinator", `Saved draft ${data.name}.`);
            history.replaceState(null, "", `/coordinator/cycles/${data.id}`);
            const { renderRoute } = await import("../app.js");
            await renderRoute();
        }
        catch (e) {
            handleError(e, "saving", [
                { field: "name", el: name },
                { field: "cutoff_local", el: cutoff },
                { field: "pickup_start_local", el: pickupStart },
                { field: "pickup_end_local", el: pickupEnd },
            ], () => [...checks.querySelectorAll("input")][0]);
            save.removeAttribute("disabled");
            save.textContent = "Save draft";
        }
    }
    name.focus();
}
// ---------- saved draft ----------
async function renderDraft(page, cycleData, etag) {
    const { data: catalog } = await api("/api/catalog");
    const revision = parseInt((etag ?? '"r1"').replace(/[^0-9]/g, ""), 10);
    const problems = el("div", { class: "problem-summary", hidden: true, "aria-label": "Problems with this cycle" });
    const name = el("input", { type: "text", value: cycleData.name });
    name.setAttribute("aria-label", "Cycle name");
    const cutoff = el("input", { type: "text" });
    cutoff.setAttribute("aria-label", "Cutoff (club time)");
    const pickupStart = el("input", { type: "text" });
    pickupStart.setAttribute("aria-label", "Pickup starts (club time)");
    const pickupEnd = el("input", { type: "text" });
    pickupEnd.setAttribute("aria-label", "Pickup ends (club time)");
    const checks = el("div", { class: "checks" });
    const timeText = (iso) => {
        if (!iso)
            return "";
        const d = new Date(iso);
        const pad = (n) => String(n).padStart(2, "0");
        const datePart = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        const timePart = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
        return `${datePart} ${timePart}`;
    };
    // Club-local values come from the display strings the server sent.
    const tz = (await clubInfo()).time_zone;
    cutoff.value = clubLocalText(cycleData.cutoff_at, tz);
    pickupStart.value = clubLocalText(cycleData.pickup_start_at, tz);
    pickupEnd.value = clubLocalText(cycleData.pickup_end_at, tz);
    const chosen = new Set(cycleData.lines.map((l) => l.product_id));
    for (const p of catalog.products) {
        const box = el("input", { type: "checkbox" });
        box.setAttribute("aria-label", p.case_name);
        box.dataset.productId = p.id;
        box.checked = chosen.has(p.id);
        checks.append(el("div", { class: "check-line" }, box, el("label", { text: `${p.case_name} — pack of ${p.pack}` })));
    }
    const save = el("button", { text: "Save draft" });
    const openBtn = el("button", { text: "Open cycle" });
    page.append(el("h1", { text: `Draft: ${cycleData.name}` }), problems, el("div", { class: "form-panel" }, el("div", { class: "field" }, el("label", { class: "label", text: "CYCLE NAME" }), name), el("div", { class: "field" }, el("label", { class: "label", text: "CUTOFF (CLUB TIME)" }), cutoff), el("div", { class: "field" }, el("label", { class: "label", text: "PICKUP STARTS (CLUB TIME)" }), pickupStart), el("div", { class: "field" }, el("label", { class: "label", text: "PICKUP ENDS (CLUB TIME)" }), pickupEnd), el("div", { class: "field" }, el("span", { class: "label", text: "CASES" }), checks)), el("div", { class: "actions" }, save, openBtn));
    const buildBody = () => {
        const body = { name: name.value };
        if (cutoff.value)
            body.cutoff_local = apiLocal(cutoff.value);
        if (pickupStart.value)
            body.pickup_start_local = apiLocal(pickupStart.value);
        if (pickupEnd.value)
            body.pickup_end_local = apiLocal(pickupEnd.value);
        const productIds = [...checks.querySelectorAll("input:checked")].map((c) => c.dataset.productId);
        if (productIds.length > 0)
            body.product_ids = productIds;
        return body;
    };
    save.addEventListener("click", () => void doPatch("save"));
    openBtn.addEventListener("click", () => void doPatch("open"));
    async function doPatch(mode) {
        const btn = mode === "save" ? save : openBtn;
        btn.setAttribute("disabled", "");
        btn.textContent = "Saving...";
        try {
            if (mode === "save") {
                const { data } = await api(`/api/cycles/${cycleData.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(buildBody()),
                    ifMatch: `"r${revision}"`,
                });
                announce("coordinator", `Saved draft ${data.name}.`);
                const { renderRoute } = await import("../app.js");
                await renderRoute();
            }
            else {
                const { data } = await api(`/api/cycles/${cycleData.id}/transitions`, {
                    method: "POST",
                    body: JSON.stringify({ to: "open", ...buildBody() }),
                    ifMatch: `"r${revision}"`,
                });
                announce("coordinator", `${data.name} is now open.`);
                const { renderRoute } = await import("../app.js");
                await renderRoute();
            }
        }
        catch (e) {
            handleError(e, mode === "save" ? "saving" : "opening", [
                { field: "name", el: name },
                { field: "cutoff_local", el: cutoff },
                { field: "pickup_start_local", el: pickupStart },
                { field: "pickup_end_local", el: pickupEnd },
            ], () => [...checks.querySelectorAll("input")][0]);
            btn.removeAttribute("disabled");
            btn.textContent = mode === "save" ? "Save draft" : "Open cycle";
        }
    }
}
// ---------- live cycle ----------
async function renderLiveCycle(page, cycleData, etag) {
    let revision = parseInt((etag ?? '"r1"').replace(/[^0-9]/g, ""), 10);
    let cycle = cycleData;
    const notices = el("div", { class: "notices", role: "region", "aria-label": "Notices" });
    const headerWrap = el("div", { class: "cycle-header" });
    const timesWrap = el("div", { class: "form-panel" });
    const atCutoffWrap = el("div", { class: "section" });
    const linesWrap = el("div", { class: "section" });
    const documentsWrap = el("div", { class: "section" });
    const transitionWrap = el("div", { class: "section" });
    const dailyWrap = el("div", { class: "section" });
    const receiptsWrap = el("div", { class: "section" });
    const unsubs = [];
    page.append(headerWrap, notices, timesWrap, atCutoffWrap, linesWrap, documentsWrap, transitionWrap, dailyWrap, receiptsWrap);
    let typedCutoff = null;
    let typedPickupStart = null;
    let typedPickupEnd = null;
    let clubTz = "America/Chicago";
    const cutoffInput = el("input", { type: "text" });
    cutoffInput.setAttribute("aria-label", "Cutoff (club time)");
    const pickupStartInput = el("input", { type: "text" });
    pickupStartInput.setAttribute("aria-label", "Pickup starts (club time)");
    const pickupEndInput = el("input", { type: "text" });
    pickupEndInput.setAttribute("aria-label", "Pickup ends (club time)");
    const saveTimes = el("button", { text: "Save times" });
    cutoffInput.addEventListener("input", () => {
        typedCutoff = cutoffInput.value;
    });
    pickupStartInput.addEventListener("input", () => {
        typedPickupStart = pickupStartInput.value;
    });
    pickupEndInput.addEventListener("input", () => {
        typedPickupEnd = pickupEndInput.value;
    });
    saveTimes.addEventListener("click", async () => {
        if (saveTimes.hasAttribute("disabled"))
            return;
        saveTimes.setAttribute("disabled", "");
        saveTimes.textContent = "Saving...";
        const body = {};
        if (typedCutoff !== null && cutoffInput.isConnected)
            body.cutoff_local = typedCutoff;
        if (typedPickupStart !== null)
            body.pickup_start_local = typedPickupStart;
        if (typedPickupEnd !== null)
            body.pickup_end_local = typedPickupEnd;
        try {
            const { data, etag: newTag } = await api(`/api/cycles/${cycle.id}`, {
                method: "PATCH",
                body: JSON.stringify(body),
                ifMatch: `"r${revision}"`,
            });
            revision = parseInt((newTag ?? '"r1"').replace(/[^0-9]/g, ""), 10);
            cycle = data;
            typedCutoff = null;
            typedPickupStart = null;
            typedPickupEnd = null;
            drawTimes();
            announce("coordinator", `Saved times for ${data.name}.`);
        }
        catch (e) {
            if (e instanceof ApiError) {
                if (e.code === "stale_cycle") {
                    const { data } = await api(`/api/cycles/${cycle.id}`);
                    cycle = data;
                    drawTimes();
                    announce("coordinator", `Someone else changed ${data.name}. The latest times are shown; check them and save again.`);
                }
                else if (e.fields) {
                    showFieldErrors(e.fields, [
                        { field: "cutoff_local", el: cutoffInput },
                        { field: "pickup_start_local", el: pickupStartInput },
                        { field: "pickup_end_local", el: pickupEndInput },
                    ], null);
                    announce("coordinator", summaryAnnouncement(e.fields, "saving"));
                }
            }
        }
        saveTimes.removeAttribute("disabled");
        saveTimes.textContent = "Save times";
        saveTimes.focus();
    });
    function drawTimes() {
        clear(timesWrap);
        if (!["open", "sealing", "ordered", "received"].includes(cycle.status))
            return;
        const rows = [];
        if (cycle.accepting_pledges)
            rows.push(fieldRow("CUTOFF (CLUB TIME)", cutoffInput));
        rows.push(fieldRow("PICKUP STARTS (CLUB TIME)", pickupStartInput));
        rows.push(fieldRow("PICKUP ENDS (CLUB TIME)", pickupEndInput));
        timesWrap.append(el("h3", { text: "Times" }), ...rows.filter((r) => r !== false), el("div", { class: "actions" }, saveTimes));
        const tz = clubTz;
        if (typedCutoff === null || !cycle.accepting_pledges && typedCutoff === "") {
            cutoffInput.value = clubLocalText(cycle.cutoff_at, tz);
        }
        if (typedPickupStart === null)
            pickupStartInput.value = clubLocalText(cycle.pickup_start_at, tz);
        if (typedPickupEnd === null)
            pickupEndInput.value = clubLocalText(cycle.pickup_end_at, tz);
        if (!cycle.accepting_pledges && document.activeElement === cutoffInput) {
            pickupStartInput.focus();
        }
    }
    function fieldRow(label, input) {
        return el("div", { class: "field" }, el("label", { class: "label", text: label }), input);
    }
    function drawHeader() {
        clear(headerWrap);
        headerWrap.append(el("h1", { text: cycle.name }), el("p", { class: "label", text: cycle.status.toUpperCase() }), el("div", { class: "times" }, el("span", {}, el("span", { class: "label", text: "CUTOFF" }), el("span", { class: "value", text: cycle.cutoff_display ?? "" })), el("span", {}, el("span", { class: "label", text: "PICKUP" }), el("span", { class: "value", text: cycle.pickup_display ?? "" }))));
    }
    let anyFailedAttempts = false;
    function drawNotices() {
        clear(notices);
        if (anyFailedAttempts) {
            notices.append(el("div", { class: "banner", text: "Receipts are queued and will send when mail is back." }));
        }
    }
    const atCutoffGroups = new Map();
    function drawAtCutoff() {
        clear(atCutoffWrap);
        atCutoffGroups.clear();
        atCutoffWrap.append(el("h2", { text: "At cutoff" }));
        const region = el("div", { role: "region", "aria-label": "At cutoff" });
        for (const line of cycle.lines) {
            const group = el("div", { class: "atcutoff-group", role: "group", "aria-label": line.case_name, tabindex: "-1" });
            const stateWords = line.status === "sealed" ? "SEALED"
                : line.status === "taken_up" ? "TAKEN UP"
                    : line.status === "dropped" ? "DROPPED"
                        : `${line.units_to_go} TO GO`;
            group.append(el("span", { class: "state-words", text: stateWords }));
            if (cycle.status === "sealing" && line.status === "filling") {
                const drop = el("button", { text: "Drop", "aria-label": `Drop ${line.case_name}` });
                const takeUp = el("button", { text: "Take up", "aria-label": `Take up ${line.case_name}` });
                drop.addEventListener("click", () => void resolve(line, "drop", drop, group));
                takeUp.addEventListener("click", () => void resolve(line, "take_up", takeUp, group));
                group.append(el("div", { class: "row-actions" }, drop, takeUp));
            }
            atCutoffGroups.set(line.product_id, group);
            region.append(group);
        }
        atCutoffWrap.append(region);
    }
    async function resolve(line, action, btn, group) {
        btn.setAttribute("disabled", "");
        btn.textContent = "Working...";
        const clubUnits = line.units_to_go;
        try {
            const { data } = await api(`/api/cycles/${cycle.id}/lines/${line.product_id}/resolution`, {
                method: "POST",
                body: JSON.stringify({ action }),
            });
            announce("coordinator", action === "drop"
                ? `Dropped ${data.case_name}. Holds released.`
                : `The club took up ${clubUnits} of ${data.case_name}.`);
            await refresh();
            if (document.activeElement === document.body || !document.body.contains(document.activeElement))
                group.focus();
            return;
        }
        catch (e) {
            if (e instanceof ApiError && e.code === "line_already_resolved") {
                const current = cycle.lines.find((l) => l.product_id === line.product_id);
                const resolution = current?.status === "dropped" ? "dropped" : "taken up";
                announce("coordinator", `${line.case_name} was already ${resolution}. Nothing changed.`);
            }
            else if (e instanceof ApiError) {
                announce("coordinator", e.message);
            }
            group.focus();
        }
        btn.removeAttribute("disabled");
        btn.textContent = action === "drop" ? "Drop" : "Take up";
    }
    function drawLines() {
        clear(linesWrap);
        linesWrap.append(el("h2", { text: "Lines" }));
        const table = el("table", { class: "data stacked", "aria-label": "Lines" });
        table.append(el("thead", {}, el("tr", {}, el("th", { text: "CASE" }), el("th", { text: "PLEDGED" }), el("th", { text: "TO GO" }), el("th", { text: "STATUS" }), el("th", { text: "SHORT UNITS" }), el("th", { text: "ACTIONS" }))));
        const tbody = el("tbody");
        for (const line of cycle.lines) {
            const recordBtn = el("button", { text: "Record short", "aria-label": `Record short: ${line.case_name}` });
            recordBtn.addEventListener("click", () => recordShortDialog(line, recordBtn));
            const statusText = line.status === "taken_up" ? "taken up" : line.status;
            tbody.append(el("tr", {}, el("td", { "data-col": "CASE", text: line.case_name }), el("td", { "data-col": "PLEDGED", text: String(line.pledged_units) }), el("td", { "data-col": "TO GO", text: String(line.units_to_go) }), el("td", { "data-col": "STATUS", text: statusText }), el("td", { "data-col": "SHORT UNITS", text: String(line.short_units) }), el("td", { "data-col": "ACTIONS" }, recordBtn)));
        }
        table.append(tbody);
        linesWrap.append(table);
        if (cycle.status === "received" || cycle.status === "breakdown") {
            void drawFlags();
        }
    }
    async function recordShortDialog(line, opener) {
        let attempt = null;
        openDialog({
            label: "Record short shipment",
            returnFocusTo: opener,
            onClose: () => { },
            build: (body, close) => {
                const input = el("input", { type: "number", value: "1", min: "1" });
                input.setAttribute("aria-label", "Units short");
                const error = el("div", { class: "field-error", hidden: true, role: "alert" });
                const record = el("button", { text: "Record short" });
                const cancel = el("button", { text: "Cancel" });
                body.append(el("h2", { text: "Record short shipment" }), el("p", { text: line.case_name }), el("div", { class: "field" }, el("label", { class: "label", text: "UNITS SHORT" }), input, error), el("div", { class: "actions" }, cancel, record));
                cancel.addEventListener("click", close);
                record.addEventListener("click", async () => {
                    const units = parseInt(input.value, 10);
                    if (!attempt || attempt.failed && attempt.units === units) {
                        attempt = { key: attempt?.key ?? newIdempotencyKey(), units, failed: false };
                    }
                    record.setAttribute("disabled", "");
                    record.textContent = "Saving...";
                    error.hidden = true;
                    try {
                        const { data } = await api(`/api/cycles/${cycle.id}/lines/${line.product_id}/shorts`, { method: "POST", body: JSON.stringify({ units }), idempotencyKey: attempt.key });
                        attempt = null;
                        announce("coordinator", `Recorded ${units} short on ${line.case_name}. Notices queued for ${data.affected.length} households.`);
                        close();
                        void refresh();
                    }
                    catch (e) {
                        record.removeAttribute("disabled");
                        record.textContent = "Record short";
                        if (e instanceof NetworkError) {
                            attempt = { key: attempt?.key ?? newIdempotencyKey(), units, failed: true };
                            error.hidden = false;
                            error.textContent = `Couldn't confirm the short on ${line.case_name}. Check your connection and try again.`;
                        }
                        else if (e instanceof ApiError && e.fields?.units) {
                            error.hidden = false;
                            error.textContent = e.fields.units;
                        }
                        else if (e instanceof ApiError) {
                            error.hidden = false;
                            error.textContent = e.message;
                        }
                    }
                });
                input.focus();
            },
        });
    }
    async function drawFlags() {
        try {
            const { data } = await api(`/api/cycles/${cycle.id}/flags`);
            const existing = linesWrap.querySelector(".flags-list");
            existing?.remove();
            const list = el("ul", { class: "flags-list", "aria-label": "Volunteer flags" });
            for (const f of data.flags) {
                const household = f.household_code;
                const line = cycle.lines.find((l) => l.product_id === f.product_id);
                list.append(el("li", { text: `${household}: ${f.units} missing of ${line?.case_name ?? f.product_id}` }));
            }
            linesWrap.append(el("h3", { text: "Volunteer flags" }), list);
        }
        catch {
            /* flags are unavailable until breakdown */
        }
    }
    function drawDocuments() {
        clear(documentsWrap);
        documentsWrap.append(el("h2", { text: "Documents" }));
        const invoiceFile = el("input", { type: "file", accept: "application/pdf" });
        invoiceFile.setAttribute("aria-label", "Distributor invoice (PDF)");
        const invoiceBtn = el("button", { text: "Upload invoice" });
        const slipFile = el("input", { type: "file", accept: "image/jpeg,image/png" });
        slipFile.setAttribute("aria-label", "Packing slip photo");
        const slipBtn = el("button", { text: "Upload packing slip" });
        const docsList = el("div");
        documentsWrap.append(el("div", { class: "field" }, el("label", { class: "label", text: "DISTRIBUTOR INVOICE (PDF)" }), invoiceFile, invoiceBtn), el("div", { class: "field" }, el("label", { class: "label", text: "PACKING SLIP PHOTO" }), slipFile, slipBtn), docsList);
        invoiceBtn.addEventListener("click", () => void upload(invoiceFile, "invoice", invoiceBtn, docsList));
        slipBtn.addEventListener("click", () => void upload(slipFile, "packing-slip", slipBtn, docsList));
        void drawDocsList(docsList);
    }
    async function upload(fileInput, kind, btn, docsList) {
        const file = fileInput.files?.[0];
        if (!file)
            return;
        btn.setAttribute("disabled", "");
        btn.textContent = "Uploading...";
        const bytes = await file.arrayBuffer();
        const contentType = kind === "invoice" ? "application/pdf" : (file.type || "image/png");
        try {
            const { data } = await api(`/api/cycles/${cycle.id}/documents/${kind}`, {
                method: "PUT",
                body: bytes,
                headers: { "Content-Type": contentType },
                raw: true,
            });
            const fileKind = kind === "invoice" ? "invoice" : "packing slip";
            announce("coordinator", `Saved ${fileKind} (${data.bytes} bytes).`);
            void drawDocsList(docsList);
        }
        catch (e) {
            if (e instanceof ApiError) {
                if (e.code === "storage_unavailable") {
                    announce("coordinator", "File storage is unavailable. Your upload was not saved.");
                }
                else if (e.code === "too_large") {
                    announce("coordinator", "That file is over 10 MB. Your upload was not saved.");
                }
                else if (e.code === "unsupported_media_type") {
                    announce("coordinator", kind === "invoice" ? "That file isn't a PDF." : "That file isn't a JPEG or PNG photo.");
                }
                else if (e.code === "upload_in_progress") {
                    announce("coordinator", "Another upload of this file is still running. Your upload was not saved.");
                }
                else {
                    announce("coordinator", e.message);
                }
            }
            else if (e instanceof NetworkError) {
                announce("coordinator", "Check your connection and try again.");
            }
        }
        btn.removeAttribute("disabled");
        btn.textContent = kind === "invoice" ? "Upload invoice" : "Upload packing slip";
    }
    async function drawDocsList(target) {
        try {
            const { data } = await api(`/api/cycles/${cycle.id}/documents`);
            clear(target);
            for (const doc of data.documents) {
                const link = el("a", { href: `/api/cycles/${cycle.id}/documents/${doc.kind}`, text: `${doc.kind} (${doc.bytes} bytes)` });
                link.addEventListener("click", (e) => e.preventDefault());
                target.append(el("div", { class: "value", text: `${doc.kind}: ${doc.bytes} bytes` }));
            }
        }
        catch {
            clear(target);
        }
    }
    function drawTransition() {
        clear(transitionWrap);
        const status = cycle.status;
        const buttons = [];
        if (status === "sealing") {
            const place = el("button", { text: "Place order" });
            place.addEventListener("click", () => void transition("ordered", place));
            const unresolved = cycle.lines.some((l) => l.status === "filling");
            if (unresolved)
                place.setAttribute("disabled", "");
            buttons.push(place);
        }
        else if (status === "ordered") {
            const received = el("button", { text: "Mark received" });
            received.addEventListener("click", () => void transition("received", received));
            buttons.push(received);
        }
        else if (status === "received") {
            const breakdown = el("button", { text: "Start breakdown" });
            breakdown.addEventListener("click", () => void transition("breakdown", breakdown));
            buttons.push(breakdown);
        }
        else if (status === "breakdown") {
            const closeBtn = el("button", { text: "Close cycle" });
            closeBtn.addEventListener("click", () => void transition("closed", closeBtn));
            buttons.push(closeBtn);
        }
        else if (status === "closing") {
            const closeBtn = el("button", { text: "Close cycle" });
            closeBtn.addEventListener("click", () => void transition("closed", closeBtn));
            buttons.push(closeBtn);
        }
        if (buttons.length > 0) {
            transitionWrap.append(el("h2", { text: "Status" }), el("div", { class: "actions" }, ...buttons));
        }
    }
    async function transition(to, btn) {
        btn.setAttribute("disabled", "");
        btn.textContent = "Working...";
        const headers = {};
        const key = to === "closed" ? newIdempotencyKey() : undefined;
        try {
            const { data } = await api(`/api/cycles/${cycle.id}/transitions`, {
                method: "POST",
                body: JSON.stringify({ to }),
                idempotencyKey: key,
            });
            if (to === "closed") {
                announce("coordinator", `${cycle.name} is closed. ${data.receipts_queued ?? 0} receipts are queued for sending.`);
            }
            else {
                announce("coordinator", `${data.name} is now ${data.status}.`);
            }
            const { renderRoute } = await import("../app.js");
            await renderRoute();
            return;
        }
        catch (e) {
            if (e instanceof ApiError) {
                if (e.code === "unresolved_lines")
                    announce("coordinator", "Drop or take up every unfilled case first.");
                else if (e.code === "invoice_missing")
                    announce("coordinator", "Upload the distributor invoice before closing.");
                else if (e.code === "payments_paused")
                    announce("coordinator", `Close did not finish. ${cycle.name} stays in closing and can be closed again.`);
                else if (e.code === "storage_unavailable")
                    announce("coordinator", `File storage is unavailable. ${cycle.name} was not closed.`);
                else if (e.code === "charge_mismatch")
                    announce("coordinator", `A charge for ${cycle.name} in billing doesn't match. ${cycle.name} stays in closing.`);
                else
                    announce("coordinator", e.message);
            }
            else if (e instanceof NetworkError) {
                announce("coordinator", "Check your connection and try again.");
            }
            void refresh();
        }
        btn.removeAttribute("disabled");
        btn.textContent = to === "closed" ? "Close cycle" : to === "ordered" ? "Place order" : to === "received" ? "Mark received" : to === "breakdown" ? "Start breakdown" : "Close cycle";
    }
    async function drawDaily() {
        clear(dailyWrap);
        dailyWrap.append(el("h2", { text: "Pledges by day" }));
        try {
            const { data } = await api(`/api/cycles/${cycle.id}/daily`);
            const table = el("table", { class: "data", "aria-label": "Pledges by day" });
            table.append(el("thead", {}, el("tr", {}, el("th", { text: "DATE" }), el("th", { text: "PLEDGED" }), el("th", { text: "WITHDRAWN" }))));
            const tbody = el("tbody");
            for (const day of data.days) {
                tbody.append(el("tr", {}, el("td", { text: day.date }), el("td", { text: String(day.units_pledged) }), el("td", { text: String(day.units_withdrawn) })));
            }
            table.append(tbody);
            dailyWrap.append(table);
        }
        catch {
            /* draft cycles have no daily rows yet */
        }
    }
    async function drawReceipts() {
        clear(receiptsWrap);
        receiptsWrap.append(el("h2", { text: "Receipts" }));
        try {
            const { data } = await api(`/api/cycles/${cycle.id}/receipts`);
            anyFailedAttempts = data.receipts.some((r) => r.failed_attempts > 0 && r.status === "queued");
            drawNotices();
            const table = el("table", { class: "data", "aria-label": "Receipts" });
            table.append(el("thead", {}, el("tr", {}, el("th", { text: "HOUSEHOLD" }), el("th", { text: "EMAIL" }), el("th", { text: "STATUS" }))));
            const tbody = el("tbody");
            for (const r of data.receipts) {
                tbody.append(el("tr", {}, el("td", { text: r.household_code }), el("td", { text: r.email }), el("td", { text: r.status })));
            }
            table.append(tbody);
            receiptsWrap.append(table);
        }
        catch {
            /* receipts only exist after closing begins */
        }
    }
    function drawAll() {
        drawHeader();
        drawNotices();
        drawTimes();
        drawAtCutoff();
        drawLines();
        drawDocuments();
        drawTransition();
    }
    async function refresh() {
        try {
            const { data, etag } = await api(`/api/cycles/${cycle.id}`);
            cycle = data;
            const freshRevision = parseInt((etag ?? '"r1"').replace(/[^0-9]/g, ""), 10);
            const holdingTyped = typedCutoff !== null || typedPickupStart !== null || typedPickupEnd !== null;
            if (!holdingTyped)
                revision = freshRevision;
            drawAll();
            await drawDaily();
            await drawReceipts();
        }
        catch {
            /* keep the page as it is */
        }
    }
    clubTz = (await clubInfo()).time_zone;
    drawAll();
    await drawDaily();
    await drawReceipts();
    const timer = setInterval(() => {
        if (!document.body.contains(page)) {
            clearInterval(timer);
            for (const u of unsubs)
                u();
            return;
        }
        void refresh();
    }, 10000);
}
// ---------- shared field error rendering ----------
function showFieldErrors(fields, inputs, firstCheckbox) {
    for (const { field, el: input } of inputs) {
        let error = input.parentElement?.querySelector(".field-error");
        if (fields[field]) {
            if (!error) {
                error = el("div", { class: "field-error", role: "alert" });
                input.parentElement?.append(error);
            }
            error.textContent = fields[field];
            error.hidden = false;
            input.setAttribute("aria-invalid", "true");
            input.setAttribute("aria-describedby", "");
            input.removeAttribute("aria-describedby");
            const id = `err-${field}`;
            error.id = id;
            input.setAttribute("aria-describedby", id);
        }
        else if (error) {
            error.hidden = true;
            error.textContent = "";
            input.removeAttribute("aria-invalid");
            input.removeAttribute("aria-describedby");
        }
    }
    if (fields.product_ids) {
        const first = firstCheckbox?.();
        let error = first?.parentElement?.parentElement?.querySelector(".field-error");
        if (!error && first) {
            error = el("div", { class: "field-error", role: "alert" });
            first.parentElement?.parentElement?.append(error);
        }
        if (error) {
            error.textContent = fields.product_ids;
            error.hidden = false;
        }
    }
}
function handleError(e, mode, inputs, firstCheckbox) {
    if (e instanceof ApiError && e.fields) {
        showFieldErrors(e.fields, inputs, firstCheckbox);
        drawProblemSummary(e.fields, inputs, mode, firstCheckbox);
        announce("coordinator", summaryAnnouncement(e.fields, mode));
    }
}
function drawProblemSummary(fields, inputs, mode, firstCheckbox) {
    const labels = {
        name: "Cycle name",
        cutoff_local: "Cutoff (club time)",
        pickup_start_local: "Pickup starts (club time)",
        pickup_end_local: "Pickup ends (club time)",
        product_ids: "Cases",
    };
    const order = ["name", "cutoff_local", "pickup_start_local", "pickup_end_local", "product_ids"];
    const summary = document.querySelector(".problem-summary");
    if (!summary)
        return;
    summary.hidden = false;
    summary.replaceChildren();
    summary.append(el("h3", { text: "Problems with this cycle" }));
    const list = el("ul", { role: "list", "aria-label": "Problems with this cycle" });
    let firstLink = null;
    for (const field of order) {
        if (!fields[field])
            continue;
        const target = inputs.find((i) => i.field === field)?.el ?? null;
        const link = el("a", { href: "#", text: `${labels[field]}: ${fields[field]}` });
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const dest = target ?? (field === "product_ids" ? firstCheckbox?.() ?? null : null);
            if (dest) {
                dest.scrollIntoView({ block: "center", behavior: "auto" });
                dest.focus();
            }
        });
        list.append(el("li", {}, link));
        if (!firstLink)
            firstLink = link;
    }
    summary.append(list);
    (firstLink ?? summary).focus();
    void inputs;
}
function summaryAnnouncement(fields, mode) {
    const n = Object.keys(fields).length;
    if (n === 1)
        return `1 problem stops this cycle from ${mode}.`;
    return `${n} problems stop this cycle from ${mode}.`;
}
