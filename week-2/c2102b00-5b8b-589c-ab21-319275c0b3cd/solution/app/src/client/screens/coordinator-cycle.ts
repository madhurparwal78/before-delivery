// Coordinator cycle: the draft form while draft, then the cycle view: times, at-cutoff
// resolutions, lines and shorts, documents, the next transition, pledges by day and receipts.
import { api, errorCode, errorFields, newKey, NoResponse } from "../api.js";
import type { Line } from "../line.js";
import { fieldValue, localText } from "../clubclock.js";
import { openDialog } from "../dialog.js";
import { h, isBusy, labelled, setBusy, setFieldError, uid } from "../dom.js";
import { announce, main, setNotice, useLive } from "../shell.js";
import { type DraftCycle, draftForm } from "./draft-form.js";

interface Cycle extends DraftCycle {
  cutoff_display: string | null;
  pickup_display: string | null;
  accepting_pledges: boolean;
  lines: Line[];
}

interface Receipt {
  household_code: string;
  email: string;
  status: string;
  failed_attempts: number;
}

interface Flag {
  household_code: string;
  product_id: string;
  units: number;
}

const REFRESH_MS = 10_000;
const TIME_EDITABLE = ["open", "sealing", "ordered", "received"];
const UPLOADABLE = ["ordered", "received", "breakdown", "closing"];
const MAIL_QUEUED = "Receipts are queued and will send when mail is back.";
const STATUS_WORD: Record<Line["status"], string> = { filling: "filling", sealed: "sealed", dropped: "dropped", taken_up: "taken up" };
/** Lines columns that hold counts: pledged, to go, short and flags. */
const NUMERIC_COLUMNS = new Set([1, 2, 4, 5]);
const NEXT: Record<string, { to: string; label: string } | undefined> = {
  sealing: { to: "ordered", label: "Place order" },
  ordered: { to: "received", label: "Mark received" },
  received: { to: "breakdown", label: "Start breakdown" },
  breakdown: { to: "closed", label: "Close cycle" },
  closing: { to: "closed", label: "Close cycle" },
};

export async function coordinatorCycleScreen([cycleId]: string[]): Promise<() => void> {
  useLive("Coordinator updates");
  main.replaceChildren(h("p", { class: "loading" }, "Loading the cycle"));
  let stop = () => undefined as void;
  const showCycle = async (id: string) => {
    stop = await cycleView(id);
  };
  if (cycleId === "new") {
    await draftForm(null, (id) => void showCycle(id));
    return () => stop();
  }
  const r = await api<Cycle>("GET", `/api/cycles/${encodeURIComponent(cycleId!)}`);
  if (r.status !== 200) {
    main.replaceChildren(h("section", { class: "panel" }, h("h1", {}, "Page not found"), h("p", {}, h("a", { href: "/coordinator" }, "Back to cycles"))));
    return () => undefined;
  }
  if (r.body.status === "draft") await draftForm(r.body, (id) => void showCycle(id));
  else await showCycle(r.body.id);
  return () => stop();
}

async function cycleView(id: string): Promise<() => void> {
  const path = `/api/cycles/${encodeURIComponent(id)}`;
  let cycle: Cycle = (await api<Cycle>("GET", path)).body;
  document.title = `${cycle.name} · Tally Split`;
  const say = (text: string) => announce("Coordinator updates", text);

  // ---- Header --------------------------------------------------------------------------------
  const statusEl = h("span", { class: "state-word" });
  const cutoffEl = h("span", { class: "value" });
  const pickupEl = h("span", { class: "value" });
  const header = h("header", { class: "panel cycle-head area-head" },
    h("p", { class: "kicker" }, "Cycle ", statusEl),
    h("h1", {}, cycle.name),
    h("div", { class: "when" }, labelled("CUTOFF", cutoffEl), labelled("PICKUP", pickupEl)));

  // ---- Times ---------------------------------------------------------------------------------
  type TimeKey = "cutoff_local" | "pickup_start_local" | "pickup_end_local";
  const timeFields: { key: TimeKey; label: string; at: "cutoff_at" | "pickup_start_at" | "pickup_end_at" }[] = [
    { key: "cutoff_local", label: "Cutoff (club time)", at: "cutoff_at" },
    { key: "pickup_start_local", label: "Pickup starts (club time)", at: "pickup_start_at" },
    { key: "pickup_end_local", label: "Pickup ends (club time)", at: "pickup_end_at" },
  ];
  const times = new Map(
    timeFields.map((f) => {
      const input = h("input", { class: "input", type: "text", id: uid("time"), "aria-label": f.label, autocomplete: "off", spellcheck: "false" });
      const error = h("p", { class: "field-error", id: uid("err"), hidden: true });
      const wrap = h("div", { class: "field" }, h("label", { class: "label", for: input.id }, f.label.toUpperCase()), input, error);
      return [f.key, { ...f, input, error, wrap, dirty: false }];
    }),
  );
  for (const t of times.values()) t.input.addEventListener("input", () => (t.dirty = true));
  let revision = cycle.revision;
  const saveTimes = h("button", { type: "button", class: "button quiet" }, "Save times");
  const timesRow = h("div", { class: "time-fields" }, ...[...times.values()].map((t) => t.wrap));
  const timesSection = h("section", { class: "panel area-times", "aria-label": "Times" },
    h("h2", { class: "panel-title" }, "Times"), timesRow, saveTimes);
  const anyDirty = () => [...times.values()].some((t) => t.dirty && t.wrap.isConnected);

  function drawTimes(c: Cycle, force: boolean): void {
    timesSection.hidden = !TIME_EDITABLE.includes(c.status);
    const cutoff = times.get("cutoff_local")!;
    if (!c.accepting_pledges && cutoff.wrap.isConnected) {
      const focused = cutoff.wrap.contains(document.activeElement);
      cutoff.wrap.remove();
      cutoff.dirty = false;
      if (focused) times.get("pickup_start_local")!.input.focus();
    }
    if (c.accepting_pledges && !cutoff.wrap.isConnected) timesRow.prepend(cutoff.wrap);
    if (!force && anyDirty()) return;
    revision = c.revision;
    for (const t of times.values()) {
      t.input.value = fieldValue(c[t.at]);
      t.dirty = false;
      setFieldError(t.input, t.error, null);
    }
  }

  saveTimes.addEventListener("click", async () => {
    if (isBusy(saveTimes)) return;
    const body: Record<string, string | null> = {};
    for (const t of times.values()) {
      if (t.wrap.isConnected && t.input.value !== fieldValue(cycle[t.at])) body[t.key] = localText(t.input.value);
    }
    setBusy(saveTimes, true, "Saving...", "Save times");
    try {
      const request = asked();
      const r = await api<Cycle>("PATCH", path, { body, ifMatch: `"r${revision}"` });
      setBusy(saveTimes, false, "Saving...", "Save times");
      if (r.status === 200) {
        if (current(request)) drawAll(r.body, true);
        say(`Saved times for ${r.body.name}.`);
      } else if (r.status === 412) {
        const newest = await latest();
        if (newest) drawAll(newest, true);
        say(`Someone else changed ${newest?.name ?? cycle.name}. The latest times are shown; check them and save again.`);
      } else if (r.status === 422) {
        const fields = errorFields(r);
        for (const t of times.values()) setFieldError(t.input, t.error, fields[t.key] ?? null);
        say(Object.values(fields).join(" "));
      } else {
        say(r.body && (r.body as never as { error: { message: string } }).error.message);
      }
    } catch (error) {
      setBusy(saveTimes, false, "Saving...", "Save times");
      if (!(error instanceof NoResponse)) throw error;
      say("Couldn't reach the server. Check your connection and try again.");
    }
  });

  // ---- At cutoff -----------------------------------------------------------------------------
  const groups = new Map<string, { group: HTMLElement; state: HTMLElement; buttons: HTMLElement }>();
  const atCutoff = h("section", { class: "panel area-cutoff", "aria-label": "At cutoff" },
    h("h2", { class: "panel-title" }, "At cutoff"),
    h("p", { class: "muted" }, "Cases that sealed are ordered. Drop or take up each case that didn't fill."));
  const groupGrid = h("div", { class: "cutoff-grid" });
  atCutoff.append(groupGrid);

  function stateText(l: Line): string {
    if (l.status === "sealed") return "SEALED";
    if (l.status === "dropped") return "DROPPED";
    if (l.status === "taken_up") return "TAKEN UP";
    return `${l.units_to_go} TO GO`;
  }

  async function resolve(line: Line, action: "drop" | "take_up", button: HTMLButtonElement, idle: string): Promise<void> {
    if (isBusy(button)) return;
    setBusy(button, true, "Working...", idle);
    try {
      const r = await api<Line>("POST", `${path}/lines/${encodeURIComponent(line.product_id)}/resolution`, { body: { action } });
      setBusy(button, false, "Working...", idle);
      if (r.status === 200) {
        drawAll({ ...cycle, lines: cycle.lines.map((l) => (l.product_id === line.product_id ? r.body : l)) }, false);
        say(action === "drop" ? `Dropped ${line.case_name}. Holds released.` : `The club took up ${r.body.pledged_units - line.pledged_units} of ${line.case_name}.`);
        return;
      }
      const fresh = (await latest()) ?? cycle;
      drawAll(fresh, false);
      if (errorCode(r) === "line_already_resolved") {
        const now = fresh.lines.find((l) => l.product_id === line.product_id)!;
        say(`${line.case_name} was already ${now.status === "dropped" ? "dropped" : "taken up"}. Nothing changed.`);
      } else {
        say((r.body as never as { error: { message: string } }).error.message);
      }
    } catch (error) {
      setBusy(button, false, "Working...", idle);
      if (!(error instanceof NoResponse)) throw error;
      say("Couldn't reach the server. Check your connection and try again.");
    }
  }

  function drawCutoff(c: Cycle): void {
    atCutoff.hidden = c.accepting_pledges || c.status === "draft";
    for (const line of c.lines) {
      let g = groups.get(line.product_id);
      if (!g) {
        const state = h("p", { class: "group-state" });
        const buttons = h("div", { class: "group-actions" });
        const group = h("div", { role: "group", "aria-label": line.case_name, tabindex: -1, class: "cutoff-case" },
          h("p", { class: "group-name" }, line.case_name), state, buttons);
        g = { group, state, buttons };
        groups.set(line.product_id, g);
        groupGrid.append(group);
      }
      g.state.textContent = stateText(line);
      g.group.dataset.state = line.status;
      const wantButtons = c.status === "sealing" && line.status === "filling";
      if (wantButtons && g.buttons.childElementCount === 0) {
        const drop = h("button", { type: "button", class: "button quiet", "aria-label": `Drop ${line.case_name}` }, "Drop");
        const take = h("button", { type: "button", class: "button primary", "aria-label": `Take up ${line.case_name}` }, "Take up");
        drop.addEventListener("click", () => void resolve(currentLine(line.product_id), "drop", drop, "Drop"));
        take.addEventListener("click", () => void resolve(currentLine(line.product_id), "take_up", take, "Take up"));
        g.buttons.append(drop, take);
      } else if (!wantButtons && g.buttons.childElementCount > 0) {
        const focused = g.buttons.contains(document.activeElement);
        g.buttons.replaceChildren();
        if (focused) g.group.focus();
      }
    }
  }

  const currentLine = (pid: string) => cycle.lines.find((l) => l.product_id === pid)!;

  // ---- Lines ---------------------------------------------------------------------------------
  const rows = new Map<string, { row: HTMLTableRowElement; cells: HTMLElement[]; action: HTMLElement }>();
  const linesBody = h("tbody");
  const flagsList = h("ul", { class: "flag-list", "aria-label": "Volunteer flags" });
  const flagsEmpty = h("p", { class: "flag-empty muted" }, "No flags from the breakdown volunteer.");
  let flags: Flag[] = [];
  let names = new Map<string, string>();
  const linesSection = h("section", { class: "panel area-lines" },
    h("h2", { class: "panel-title" }, "Lines"),
    h("div", { class: "table-wrap" },
      h("table", { class: "table stack lines", "aria-label": "Lines" },
        h("thead", {}, h("tr", {}, ...["CASE", "PLEDGED", "TO GO", "STATUS", "SHORT", "FLAGS", "ACTION"].map((c, i) => h("th", { scope: "col", class: NUMERIC_COLUMNS.has(i) ? "num" : null }, c)))),
        linesBody)),
    h("h3", { class: "label sub" }, "VOLUNTEER FLAGS"),
    flagsList,
    flagsEmpty);

  function drawLines(c: Cycle): void {
    for (const line of c.lines) {
      let r = rows.get(line.product_id);
      if (!r) {
        const cells = [0, 1, 2, 3, 4, 5].map(() => h("td"));
        const action = h("td", { class: "row-action" });
        const labels = ["CASE", "PLEDGED", "TO GO", "STATUS", "SHORT", "FLAGS"];
        cells.forEach((cell, i) => {
          cell.setAttribute("data-label", labels[i]!);
          if (NUMERIC_COLUMNS.has(i)) cell.className = "num";
        });
        action.setAttribute("data-label", "ACTION");
        const row = h("tr", {}, ...cells, action);
        r = { row, cells, action };
        rows.set(line.product_id, r);
        linesBody.append(row);
      }
      const flagged = flags.filter((f) => f.product_id === line.product_id).reduce((s, f) => s + f.units, 0);
      const text = [line.case_name, String(line.pledged_units), String(line.units_to_go), STATUS_WORD[line.status], String(line.short_units), String(flagged)];
      r.cells.forEach((cell, i) => {
        if (cell.textContent !== text[i]) cell.textContent = text[i]!;
      });
      const canShort = (c.status === "received" || c.status === "breakdown") && (line.status === "sealed" || line.status === "taken_up");
      if (r.action.childElementCount === 0) {
        const button = h("button", { type: "button", class: "button quiet", "aria-label": `Record short: ${line.case_name}` }, "Record short");
        button.addEventListener("click", () => openRecordShort(line.product_id, button));
        r.action.replaceChildren(button);
      }
      (r.action.firstElementChild as HTMLButtonElement).disabled = !canShort;
    }
    flagsList.replaceChildren(
      ...flags.map((f) => h("li", {}, `${names.get(f.household_code) ?? f.household_code}: ${f.units} missing of ${currentLine(f.product_id)?.case_name ?? f.product_id}`)),
    );
    flagsEmpty.hidden = flags.length > 0;
  }

  function openRecordShort(pid: string, opener: HTMLButtonElement): void {
    const units = h("input", { class: "input", type: "number", min: 1, step: 1, inputmode: "numeric", id: uid("short"), "aria-label": "Units short" });
    const error = h("p", { class: "field-error", id: uid("err"), hidden: true });
    const record = h("button", { type: "button", class: "button primary" }, "Record short");
    const cancel = h("button", { type: "button", class: "button quiet" }, "Cancel");
    const line = currentLine(pid);
    let attempt: { key: string; value: string } | null = null;
    const dialog = openDialog({
      title: "Record short shipment",
      body: [
        h("p", {}, `${line.case_name}: ${line.pack - line.short_units} of ${line.pack} delivered units are not yet short.`),
        h("div", { class: "field" }, h("label", { class: "label", for: units.id }, "UNITS SHORT"), units, error),
      ],
      actions: [record, cancel],
      initialFocus: () => units,
      onClosed: () => opener.focus(),
    });
    cancel.addEventListener("click", () => dialog.close());
    const submit = async () => {
      if (isBusy(record)) return;
      if (!attempt || attempt.value !== units.value) attempt = { key: newKey(), value: units.value };
      const value = Number(attempt.value);
      setBusy(record, true, "Saving...", "Record short");
      try {
        const r = await api("POST", `${path}/lines/${encodeURIComponent(pid)}/shorts`, {
          body: { units: Number.isInteger(value) && attempt.value.trim() !== "" ? value : attempt.value },
          key: attempt.key,
        });
        setBusy(record, false, "Saving...", "Record short");
        if (r.status === 201) {
          const households = (r.body.affected as { pledger: string }[]).filter((a) => a.pledger !== "club").length;
          dialog.close();
          say(`Recorded ${value} short on ${line.case_name}. Notices queued for ${households} households.`);
          const newest = await latest();
          if (newest) drawAll(newest, false);
          return;
        }
        const text = errorFields(r).units ?? (r.body as { error: { message: string } }).error.message;
        setFieldError(units, error, text);
        say(text);
      } catch (e) {
        setBusy(record, false, "Saving...", "Record short");
        if (!(e instanceof NoResponse)) throw e;
        const text = `Couldn't confirm the short on ${line.case_name}. Check your connection and try again.`;
        setFieldError(units, error, text);
        say(text);
      }
    };
    record.addEventListener("click", () => void submit());
    units.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    });
  }

  // ---- Documents -----------------------------------------------------------------------------
  const docList = h("ul", { class: "doc-list" });
  const uploads = h("div", { class: "uploads" });
  const docsSection = h("section", { class: "panel area-docs" }, h("h2", { class: "panel-title" }, "Documents"), docList, uploads);

  function uploadControl(kind: "invoice" | "packing-slip", label: string, accept: string, buttonText: string, fileWord: string) {
    const input = h("input", { type: "file", id: uid("file"), accept, class: "visually-hidden", tabindex: -1 });
    const chosen = h("span", { class: "file-name muted" }, "No file chosen");
    const pick = h("button", { type: "button", class: "button", onclick: () => input.click() }, `Choose ${fileWord}`);
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      chosen.textContent = file ? `${file.name} · ${file.size.toLocaleString("en-US")} bytes` : "No file chosen";
      chosen.classList.toggle("muted", !file);
    });
    const button = h("button", { type: "button", class: "button quiet" }, buttonText);
    button.addEventListener("click", async () => {
      if (isBusy(button)) return;
      const file = input.files?.[0];
      if (!file) {
        say(`Choose the ${fileWord} file first.`);
        pick.focus();
        return;
      }
      setBusy(button, true, "Uploading...", buttonText);
      try {
        const r = await api("PUT", `${path}/documents/${kind}`, { raw: file, contentType: file.type || "application/octet-stream" });
        setBusy(button, false, "Uploading...", buttonText);
        const code = errorCode(r);
        if (r.status === 201) say(`Saved ${fileWord} (${r.body.bytes} bytes).`);
        else if (code === "storage_unavailable") say("File storage is unavailable. Your upload was not saved.");
        else if (code === "too_large") say("That file is over 10 MB. Your upload was not saved.");
        else if (code === "unsupported_media_type") say(kind === "invoice" ? "That file isn't a PDF." : "That file isn't a JPEG or PNG photo.");
        else say((r.body as { error: { message: string } }).error.message);
        await drawDocuments();
      } catch (error) {
        setBusy(button, false, "Uploading...", buttonText);
        if (!(error instanceof NoResponse)) throw error;
        say("Couldn't reach the server. Your upload was not confirmed.");
      }
    });
    return h("div", { class: "field upload" }, h("label", { for: input.id, class: "field-label" }, label), input,
      h("div", { class: "file-row" }, pick, chosen), button);
  }
  uploads.append(
    uploadControl("invoice", "Distributor invoice (PDF)", "application/pdf", "Upload invoice", "invoice"),
    uploadControl("packing-slip", "Packing slip photo", "image/jpeg,image/png", "Upload packing slip", "packing slip"),
  );

  async function drawDocuments(): Promise<void> {
    const r = await api("GET", `${path}/documents`).catch(() => null);
    if (r?.status !== 200) return;
    const docs: { kind: string; bytes: number; uploaded_at: string }[] = r.body.documents;
    docList.replaceChildren(
      ...(docs.length
        ? docs.map((d) =>
            h("li", {},
              h("a", { href: `${path}/documents/${d.kind}`, download: true }, d.kind === "invoice" ? "Distributor invoice" : "Packing slip"),
              " ", h("span", { class: "muted" }, `${d.bytes.toLocaleString("en-US")} bytes`)))
        : [h("li", { class: "muted" }, "No documents stored yet.")]),
    );
  }

  // ---- Transition ----------------------------------------------------------------------------
  const transitionSlot = h("section", { class: "panel area-next", "aria-label": "Next step" });
  let transitionButton: HTMLButtonElement | null = null;
  let transitionFor = "";

  async function runTransition(to: string, button: HTMLButtonElement, label: string): Promise<void> {
    if (isBusy(button) || button.disabled) return;
    const closing = to === "closed";
    setBusy(button, true, closing ? "Closing..." : "Working...", label);
    try {
      const r = await api("POST", `${path}/transitions`, { body: { to }, ...(closing ? { key: newKey() } : {}) });
      setBusy(button, false, closing ? "Closing..." : "Working...", label);
      const code = errorCode(r);
      if (r.status === 200) {
        const c = closing ? r.body.cycle : r.body;
        say(closing ? `${c.name} is closed. ${r.body.receipts_queued} receipts are queued for sending.` : `${c.name} is now ${c.status}.`);
      } else if (code === "unresolved_lines") say("Drop or take up every unfilled case first.");
      else if (code === "invoice_missing") say("Upload the distributor invoice before closing.");
      else if (code === "storage_unavailable") say(`File storage is unavailable. ${cycle.name} was not closed.`);
      else if (code === "payments_paused") say(`Close did not finish. ${cycle.name} stays in closing and can be closed again.`);
      else if (code === "charge_mismatch") say(`A charge for ${cycle.name} in billing doesn't match. ${cycle.name} stays in closing.`);
      else say((r.body as { error: { message: string } }).error.message);
      await refresh();
    } catch (error) {
      setBusy(button, false, closing ? "Closing..." : "Working...", label);
      if (!(error instanceof NoResponse)) throw error;
      say("Couldn't reach the server. Check your connection and try again.");
    }
  }

  function drawTransition(c: Cycle): void {
    const next = NEXT[c.status];
    if (transitionFor !== c.status) {
      transitionFor = c.status;
      const focused = transitionButton !== null && transitionButton === document.activeElement;
      transitionButton = null;
      if (next) {
        const button = h("button", { type: "button", class: "button primary big" }, next.label);
        button.addEventListener("click", () => void runTransition(next.to, button, next.label));
        transitionButton = button;
      }
      transitionSlot.replaceChildren(
        h("h2", { class: "panel-title" }, "Next step"),
        transitionButton ?? h("p", { class: "muted" }, c.status === "closed" ? "This cycle is closed." : "Members are pledging until cutoff."),
      );
      if (focused) transitionButton?.focus();
    }
    if (transitionButton && c.status === "sealing") transitionButton.disabled = c.lines.some((l) => l.status === "filling");
  }

  // ---- Pledges by day and receipts -----------------------------------------------------------
  const dailyBody = h("tbody");
  const dailySection = h("section", { class: "panel area-daily" },
    h("h2", { class: "panel-title" }, "Pledges by day"),
    h("div", { class: "table-wrap" },
      h("table", { class: "table", "aria-label": "Pledges by day" },
        h("thead", {}, h("tr", {}, ...["DATE", "PLEDGED", "WITHDRAWN"].map((c, i) => h("th", { scope: "col", class: i ? "num" : null }, c)))),
        dailyBody)));
  const receiptsBody = h("tbody");
  const receiptsSection = h("section", { class: "panel area-receipts" },
    h("h2", { class: "panel-title" }, "Receipts"),
    h("div", { class: "table-wrap" },
      h("table", { class: "table stack", "aria-label": "Receipts" },
        h("thead", {}, h("tr", {}, ...["HOUSEHOLD", "EMAIL", "STATUS"].map((c) => h("th", { scope: "col" }, c)))),
        receiptsBody)));

  async function drawSideTables(c: Cycle): Promise<void> {
    const [daily, receipts, flagged, bags] = await Promise.all([
      api("GET", `${path}/daily`).catch(() => null),
      api("GET", `${path}/receipts`).catch(() => null),
      api("GET", `${path}/flags`).catch(() => null),
      ["breakdown", "closing", "closed"].includes(c.status) ? api("GET", `${path}/bags`).catch(() => null) : Promise.resolve(null),
    ]);
    if (daily?.status === 200) {
      const days: { date: string; units_pledged: number; units_withdrawn: number }[] = daily.body.days;
      dailyBody.replaceChildren(
        ...(days.length
          ? days.map((d) => h("tr", {}, h("td", {}, d.date), h("td", { class: "num" }, String(d.units_pledged)), h("td", { class: "num" }, String(d.units_withdrawn))))
          : [h("tr", {}, h("td", { colspan: 3, class: "muted" }, "No pledges yet."))]),
      );
    }
    if (bags?.status === 200) {
      names = new Map((bags.body.bags as { household_code: string; household_name: string }[]).map((b) => [b.household_code, b.household_name]));
    }
    if (receipts?.status === 200) {
      const list: Receipt[] = receipts.body.receipts;
      receiptsBody.replaceChildren(
        ...(list.length
          ? list.map((r) => h("tr", {},
              h("td", { "data-label": "HOUSEHOLD" }, names.get(r.household_code) ?? r.household_code),
              h("td", { "data-label": "EMAIL" }, r.email),
              h("td", { "data-label": "STATUS" }, h("span", { class: `state-word mail-${r.status}` }, r.status))))
          : [h("tr", {}, h("td", { colspan: 3, class: "muted" }, "Receipts are queued when the cycle closes."))]),
      );
      setNotice("mail", list.some((r) => r.status === "queued" && r.failed_attempts > 0) ? MAIL_QUEUED : null, "info");
    }
    if (flagged?.status === 200) flags = flagged.body.flags;
    drawLines(cycle);
  }

  // ---- Drawing and refresh -------------------------------------------------------------------
  function drawAll(c: Cycle, forceTimes: boolean): void {
    cycle = c;
    statusEl.textContent = c.status;
    cutoffEl.textContent = c.cutoff_display ?? "";
    pickupEl.textContent = c.pickup_display ?? "";
    drawTimes(c, forceTimes);
    drawCutoff(c);
    drawLines(c);
    uploads.hidden = !UPLOADABLE.includes(c.status);
    drawTransition(c);
  }

  // Cycle-level values apply only from a request sent after the one behind the values on screen.
  let sent = 0;
  let shownFrom = 0;
  const asked = () => ++sent;
  function current(request: number): boolean {
    if (request <= shownFrom) return false;
    shownFrom = request;
    return true;
  }

  /** The cycle as the server holds it now, or null when a later-sent request has already been drawn. */
  async function latest(): Promise<Cycle | null> {
    const request = asked();
    const r = await api<Cycle>("GET", path).catch(() => null);
    return r?.status === 200 && current(request) ? r.body : null;
  }

  async function refresh(): Promise<void> {
    const next = await latest();
    if (!next) return;
    drawAll(next, false);
    await Promise.all([drawSideTables(next), drawDocuments()]);
  }

  drawAll(cycle, true);
  main.replaceChildren(
    h("div", { class: "coord-cycle" }, header, timesSection, atCutoff, linesSection,
      h("div", { class: "area-side" }, docsSection, receiptsSection), transitionSlot, dailySection),
  );
  await Promise.all([drawSideTables(cycle), drawDocuments()]);
  const timer = window.setInterval(() => void refresh(), REFRESH_MS);
  return () => {
    clearInterval(timer);
    setNotice("mail", null);
  };
}
