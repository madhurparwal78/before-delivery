// Every dialog: new directive, ingest revision, withdraw, tail, import, erase, scope.

import { announceError, closeLayer, element, focusFirst, openLayer } from "./a11y.js";
import * as api from "./client.js";
import { AUTHORITIES, MODEL_LABELS, PENDING, SUCCESS } from "./copy.js";
import { directiveLabel, hooks, runAction, state } from "./store.js";

function sheet({ title, fields, actions, wide }) {
  const form = element("div", { class: "fields" }, fields);
  const body = element("div", { class: `sheet${wide ? " wide" : ""}`, role: "dialog",
    "aria-modal": "true", "aria-label": title }, [
    element("h2", { text: title }),
    form,
    element("div", { class: "actions" }, actions),
  ]);
  const scrim = element("div", { class: "scrim" }, [body]);
  document.getElementById("layers").append(scrim);
  const layer = openLayer({ node: scrim, modal: true, kind: "dialog" });
  focusFirst(body);
  return { layer, body };
}

function labelled(label, control) {
  return element("label", {}, [label, control, element("span", { class: "fielderror",
    dataset: { errorFor: label } })]);
}

function textbox(label, { value = "", type = "text", multiline = false } = {}) {
  const control = element(multiline ? "textarea" : "input", {
    type: multiline ? null : type,
    "aria-label": label,
    dataset: { field: label },
    rows: multiline ? "3" : null,
  });
  control.value = value;
  return labelled(label, control);
}

function spin(label, { value = "" } = {}) {
  const control = element("input", {
    type: "number",
    step: "any",
    "aria-label": label,
    dataset: { field: label },
  });
  control.value = value;
  return labelled(label, control);
}

function picker(label, options, { value = "" } = {}) {
  const control = element(
    "select",
    { "aria-label": label, dataset: { field: label } },
    options.map(([optionValue, text]) =>
      element("option", { value: optionValue, text, selected: optionValue === value })
    )
  );
  control.value = value;
  return labelled(label, control);
}

function fileInput(label) {
  return labelled(label, element("input", {
    type: "file",
    "aria-label": label,
    dataset: { field: label },
  }));
}

function read(body, label) {
  const control = body.querySelector(`[data-field="${label}"]`);
  return control ? control.value.trim() : "";
}

function showFieldErrors(body, fields) {
  for (const node of body.querySelectorAll("[data-error-for]")) node.textContent = "";
  const map = {
    authority: "Authority",
    number: "Directive number",
    title: "Title",
    effective_date: "Effective date",
    calendar_days: "Calendar limit in days",
    fh_interval: "Flight-hours limit",
    method: "Method of compliance",
    applicability: "Applicability",
    document_id: "Directive document",
    reason: "Withdrawal reason",
    hours: "Sector hours",
    file: "History file",
    revision: "Revision",
  };
  let first = null;
  for (const [name, message] of Object.entries(fields)) {
    const label = map[name] || name;
    const slot = body.querySelector(`[data-error-for="${label}"]`);
    if (slot) slot.textContent = message;
    const control = body.querySelector(`[data-field="${label}"]`);
    if (control && !first) first = control;
  }
  if (first) first.focus();
  else announceError(Object.values(fields)[0] || "Some fields need attention.");
}

// ------------------------------------------------------------------ applicability

function applicabilityGroup(ranges = [{}]) {
  const group = element("div", { role: "group", "aria-label": "Applicability" });
  const add = element("button", {
    text: "Add range",
    "aria-label": "Add range",
    onclick: () => group.insertBefore(rangeRow(group, {}), add),
  });
  for (const range of ranges) group.append(rangeRow(group, range));
  group.append(add);
  return group;
}

function rangeRow(group, range) {
  const row = element("div", { class: "range" });
  row.append(
    picker("Model", Object.entries(MODEL_LABELS).map(([code, label]) => [code, label]), {
      value: range.model || "ATR72-212A",
    }),
    spin("First serial", { value: range.msn_from ?? "" }),
    spin("Last serial", { value: range.msn_to ?? "" }),
    element("button", {
      text: "Remove range",
      "aria-label": "Remove range",
      onclick: () => {
        if (group.querySelectorAll(".range").length > 1) row.remove();
      },
    })
  );
  return row;
}

function readRanges(body) {
  const rows = [...body.querySelectorAll(".range")];
  return rows.map((row) => ({
    model: row.querySelector('[data-field="Model"]').value,
    msn_from: Number(row.querySelector('[data-field="First serial"]').value),
    msn_to: Number(row.querySelector('[data-field="Last serial"]').value),
  }));
}

async function uploadDocument(body, directiveLabelText) {
  const input = body.querySelector('[data-field="Directive document"]');
  const file = input && input.files && input.files[0];
  if (!file) return { ok: true, documentId: null };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const response = await api.post("/api/documents", bytes, { contentType: "application/pdf" });
  if (!response.ok) {
    if (response.error && response.error.code === "storage_unavailable") {
      announceError("Document storage is unavailable. Nothing was ingested.");
    } else if (response.error && response.error.code === "validation") {
      showFieldErrors(body, { document_id: response.error.fields.document || "must be a PDF" });
    } else {
      announceError(`${directiveLabelText}: the document could not be stored.`);
    }
    return { ok: false };
  }
  return { ok: true, documentId: response.body.document_id };
}

// ------------------------------------------------------------------ directives

export function openNewDirective() {
  const fields = [
    picker("Authority", AUTHORITIES.map((name) => [name, name]), { value: "EASA" }),
    textbox("Directive number"),
    textbox("Title"),
    textbox("Effective date", { value: new Date().toISOString().slice(0, 10) }),
    spin("Calendar limit in days", { value: 180 }),
    spin("Flight-hours limit", { value: 600 }),
    textbox("Method of compliance", { multiline: true }),
    applicabilityGroup(),
    fileInput("Directive document"),
  ];
  const ingest = element("button", { class: "primary", text: "Ingest", "aria-label": "Ingest" });
  const cancel = element("button", {
    text: "Cancel",
    "aria-label": "Cancel",
    onclick: () => closeLayer(layer),
  });
  const { layer, body } = sheet({ title: "New directive", fields, actions: [ingest, cancel] });
  ingest.addEventListener("click", async () => {
    const document_id = await uploadDocument(body, "New directive");
    if (!document_id.ok) return;
    const payload = {
      authority: read(body, "Authority"),
      number: read(body, "Directive number"),
      title: read(body, "Title"),
      effective_date: read(body, "Effective date"),
      calendar_days: Number(read(body, "Calendar limit in days")),
      fh_interval: Number(read(body, "Flight-hours limit")),
      method: read(body, "Method of compliance"),
      applicability: readRanges(body),
      document_id: document_id.documentId,
    };
    const response = await runAction({
      pending: PENDING.ingest("R1"),
      run: () => api.post("/api/directives", payload),
      success: (result) =>
        SUCCESS.ingest(directiveLabel(result.body.directive), result.body.directive.revision),
      context: { directive: `${payload.authority} ${payload.number}` },
      onFields: (errors) => showFieldErrors(body, errors),
    });
    if (response.ok) {
      closeLayer(layer);
      await hooks.applySplice(response.body.directive.id, response.body.splice);
    }
  });
}

export async function openIngestRevision(directive) {
  const loaded = await api.get(`/api/directives/${directive.id}`);
  const revisions = loaded.ok ? loaded.body.directive.revisions : [];
  const current = revisions.length ? revisions[revisions.length - 1] : null;
  const next = (current ? current.revision : Number(directive.revision.slice(1))) + 1;
  const fields = [
    textbox("Title", { value: directive.title }),
    textbox("Effective date", { value: new Date().toISOString().slice(0, 10) }),
    spin("Calendar limit in days", { value: current ? current.calendar_days : 180 }),
    spin("Flight-hours limit", { value: current ? current.fh_interval : 600 }),
    textbox("Method of compliance", { value: current ? current.method : "", multiline: true }),
    applicabilityGroup(current ? current.applicability : [{}]),
    labelled(
      "Credit work done under the prior revision",
      element("input", {
        type: "checkbox",
        "aria-label": "Credit work done under the prior revision",
        dataset: { field: "Credit work done under the prior revision" },
      })
    ),
    fileInput("Directive document"),
  ];
  const ingest = element("button", { class: "primary", text: "Ingest", "aria-label": "Ingest" });
  const cancel = element("button", {
    text: "Cancel",
    "aria-label": "Cancel",
    onclick: () => closeLayer(layer),
  });
  const { layer, body } = sheet({
    title: `Ingest revision ${directiveLabel(directive)}`,
    fields,
    actions: [ingest, cancel],
  });
  ingest.addEventListener("click", async () => {
    const document_id = await uploadDocument(body, directiveLabel(directive));
    if (!document_id.ok) return;
    const payload = {
      revision: next,
      prior_credit: body.querySelector(
        '[data-field="Credit work done under the prior revision"]'
      ).checked,
      title: read(body, "Title"),
      effective_date: read(body, "Effective date"),
      calendar_days: Number(read(body, "Calendar limit in days")),
      fh_interval: Number(read(body, "Flight-hours limit")),
      method: read(body, "Method of compliance"),
      applicability: readRanges(body),
      document_id: document_id.documentId,
    };
    const response = await runAction({
      pending: PENDING.ingest(`R${next}`),
      run: () => api.post(`/api/directives/${directive.id}/revisions`, payload),
      success: (result) =>
        SUCCESS.ingest(directiveLabel(result.body.directive), result.body.directive.revision),
      context: { directive: directiveLabel(directive) },
      onFields: (errors) => showFieldErrors(body, errors),
    });
    if (response.ok) {
      closeLayer(layer);
      await hooks.applySplice(directive.id, response.body.splice);
    }
  });
}

export function openWithdraw(directive) {
  const fields = [textbox("Withdrawal reason", { multiline: true })];
  const withdraw = element("button", {
    class: "primary",
    text: "Withdraw",
    "aria-label": "Withdraw",
  });
  const cancel = element("button", {
    text: "Cancel",
    "aria-label": "Cancel",
    onclick: () => closeLayer(layer),
  });
  const { layer, body } = sheet({
    title: `Withdraw ${directiveLabel(directive)}`,
    fields,
    actions: [withdraw, cancel],
  });
  withdraw.addEventListener("click", async () => {
    const response = await runAction({
      pending: PENDING.withdraw,
      run: () =>
        api.post(`/api/directives/${directive.id}/withdrawal`, {
          reason: read(body, "Withdrawal reason"),
        }),
      success: () => SUCCESS.withdraw(directiveLabel(directive)),
      context: { directive: directiveLabel(directive) },
      onFields: (errors) => showFieldErrors(body, { reason: Object.values(errors)[0] }),
    });
    if (response.ok) {
      closeLayer(layer);
      await hooks.refreshBoard();
    }
  });
}

// ------------------------------------------------------------------ tail panel

export async function openTail(registration) {
  const response = await api.get(`/api/tails`);
  const tail = response.ok
    ? response.body.tails.find((entry) => entry.registration === registration)
    : null;
  const fields = [
    element("dl", {}, [
      element("dt", { text: "Model" }),
      element("dd", { text: tail ? MODEL_LABELS[tail.model] : "—" }),
      element("dt", { text: "MSN" }),
      element("dd", { text: tail ? String(tail.msn) : "—" }),
      element("dt", { text: "Total hours" }),
      element("dd", { text: tail ? tail.total_hours.toFixed(1) : "—" }),
    ]),
  ];
  const actions = [];
  if (state.user.role === "compliance_planner") {
    fields.push(spin("Sector hours", { value: "" }));
    const log = element("button", {
      class: "primary",
      text: "Log hours",
      "aria-label": "Log hours",
    });
    actions.push(log);
    actions.push(
      element("button", { text: "Cancel", "aria-label": "Cancel",
        onclick: () => closeLayer(layer) })
    );
    const { layer, body } = sheet({ title: `Tail ${registration}`, fields, actions });
    log.addEventListener("click", async () => {
      const result = await runAction({
        pending: PENDING.hours,
        run: () =>
          api.post(`/api/tails/${encodeURIComponent(registration)}/flight-hours`, {
            hours: Number(read(body, "Sector hours")),
          }),
        success: (done) => SUCCESS.hours(registration, done.body.total_hours),
        onFields: (errors) => showFieldErrors(body, errors),
      });
      if (result.ok) {
        closeLayer(layer);
        await hooks.refreshBoard();
      }
    });
    return;
  }
  const { layer } = sheet({
    title: `Tail ${registration}`,
    fields,
    actions: [element("button", { text: "Cancel", "aria-label": "Cancel",
      onclick: () => closeLayer(layer) })],
  });
}

// ------------------------------------------------------------------ import

export function openImport() {
  const result = element("div", { role: "region", "aria-label": "Import result" });
  const fields = [fileInput("History file"), result];
  const run = element("button", { class: "primary", text: "Import", "aria-label": "Import" });
  const cancel = element("button", {
    text: "Cancel",
    "aria-label": "Cancel",
    onclick: () => closeLayer(layer),
  });
  const { layer, body } = sheet({
    title: "Import history",
    fields,
    actions: [run, cancel],
    wide: true,
  });
  let key = null;
  run.addEventListener("click", async () => {
    const input = body.querySelector('[data-field="History file"]');
    const file = input.files && input.files[0];
    if (!file) {
      showFieldErrors(body, { file: "Choose the exported spreadsheet." });
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    key = key || api.newKey();
    const response = await runAction({
      pending: PENDING.import,
      run: () => api.post("/api/imports", bytes, { contentType: "text/csv", key }),
      success: (done) =>
        done.body.replayed_file ? SUCCESS.importReplayed : SUCCESS.import(done.body),
      onFields: (errors) => showFieldErrors(body, errors),
    });
    if (!response.ok) return;
    key = null;
    renderImportResult(result, response.body);
    await hooks.refreshBoard();
  });
}

function renderImportResult(target, outcome) {
  target.textContent = "";
  target.append(
    element("dl", {}, [
      element("dt", { text: "Rows" }),
      element("dd", { text: String(outcome.rows) }),
      element("dt", { text: "Merged" }),
      element("dd", { text: String(outcome.merged) }),
      element("dt", { text: "Duplicates" }),
      element("dd", { text: String(outcome.duplicates) }),
      element("dt", { text: "Closed" }),
      element("dd", { text: String(outcome.closed) }),
      element("dt", { text: "Orphans" }),
      element("dd", { text: String(outcome.orphans.length) }),
      element("dt", { text: "Rejected" }),
      element("dd", { text: String(outcome.rejected.length) }),
    ])
  );
  target.append(
    table("Orphan rows", ["Row", "Tail", "Directive", "Revision", "Reason"],
      outcome.orphans.map((row) => [row.row, row.tail, row.directive, row.revision || "—",
        row.reason]))
  );
  target.append(
    table("Rejected rows", ["Row", "Field", "Message"],
      outcome.rejected.map((row) => [row.row, row.field, row.message]))
  );
}

function table(label, columns, rows) {
  return element("table", { "aria-label": label }, [
    element("caption", { text: label }),
    element("thead", {}, [
      element("tr", {}, columns.map((column) => element("th", { text: column }))),
    ]),
    element(
      "tbody",
      {},
      rows.length
        ? rows.map((row) =>
            element("tr", {}, row.map((value, index) =>
              element("td", { class: index === 0 ? "num" : "wrap", text: String(value) })))
          )
        : [element("tr", {}, [element("td", { colspan: String(columns.length), text: "None" })])]
    ),
  ]);
}

// ------------------------------------------------------------------ people

export function openErase(person) {
  const fields = [textbox("Erasure reason", { multiline: true })];
  const erase = element("button", { class: "primary", text: "Erase", "aria-label": "Erase" });
  const cancel = element("button", {
    text: "Cancel",
    "aria-label": "Cancel",
    onclick: () => closeLayer(layer),
  });
  const { layer, body } = sheet({ title: "Erase contractor", fields,
    actions: [erase, cancel] });
  erase.addEventListener("click", async () => {
    const response = await runAction({
      pending: PENDING.erase,
      run: () =>
        api.post(`/api/people/${person.id}/erasure`, { reason: read(body, "Erasure reason") }),
      success: (done) => SUCCESS.erase(done.body.person.display_name),
      onFields: (errors) => showFieldErrors(body, { reason: Object.values(errors)[0] }),
    });
    if (response.ok) {
      closeLayer(layer);
      if (hooks.refreshPeople) await hooks.refreshPeople();
      await hooks.refreshBoard();
    }
  });
}

export function openScope(engineer) {
  const boxes = Object.entries(MODEL_LABELS).map(([code, label]) => {
    const input = element("input", {
      type: "checkbox",
      "aria-label": label,
      dataset: { field: label, model: code },
    });
    input.checked = (engineer.scope || []).includes(code);
    return element("label", {}, [label, input]);
  });
  const save = element("button", {
    class: "primary",
    text: "Save scope",
    "aria-label": "Save scope",
  });
  const cancel = element("button", {
    text: "Cancel",
    "aria-label": "Cancel",
    onclick: () => closeLayer(layer),
  });
  const { layer, body } = sheet({
    title: `Certification scope ${engineer.display_name}`,
    fields: boxes,
    actions: [save, cancel],
  });
  save.addEventListener("click", async () => {
    const models = [...body.querySelectorAll("input[type=checkbox]")]
      .filter((input) => input.checked)
      .map((input) => input.dataset.model);
    const response = await runAction({
      pending: PENDING.scope,
      run: () => api.put(`/api/engineers/${engineer.id}/scope`, { models }),
      success: (done) => SUCCESS.scope(done.body.succession.length),
    });
    if (response.ok) {
      closeLayer(layer);
      if (hooks.refreshPeople) await hooks.refreshPeople();
      await hooks.refreshBoard();
    }
  });
}
