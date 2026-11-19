// Dialogs: new directive, ingest revision, withdraw, import history, erase contractor, certification scope.

import { keyed, request } from "./api.js";
import { field } from "./drawer.js";
import { AUTHORITIES, clearFieldErrors, dname, fieldError, h, MODEL_LABELS, modal } from "./ui.js";

const NUMBER_HINTS = { EASA: "YYYY-NNNN", "UK CAA": "G-YYYY-NNNN", ATR: "ATR72-CC-NNNN", "De Havilland": "84-CC-NNNN",
  Embraer: "E170-CC-NNNN" };

function dayInLondon(instant) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric",
    month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function rangeRow(onRemove) {
  const model = h("select", { class: "select" }, h("option", { value: "" }, "Choose model"),
    Object.entries(MODEL_LABELS).map(([code, label]) => h("option", { value: code }, label)));
  const first = h("input", { type: "number", class: "input num", min: "0", step: "1", inputmode: "numeric" });
  const last = h("input", { type: "number", class: "input num", min: "0", step: "1", inputmode: "numeric" });
  const row = h("div", { class: "range" }, field("Model", model), field("First serial", first), field("Last serial", last));
  row.append(h("button", { type: "button", class: "btn btn--quiet range__remove", onclick: () => onRemove(row) }, "Remove range"));
  row.inputs = { model, first, last };
  return row;
}

/** New directive (no directive given) or Ingest revision (directive given). */
export function openDirectiveDialog(app, directive) {
  const revision = directive ? Number(directive.revision.slice(1)) + 1 : 1;
  const name = directive ? dname(directive) : null;
  const dlg = modal({ label: directive ? `Ingest revision ${name}` : "New directive", wide: true });
  const authority = h("select", { class: "select" }, AUTHORITIES.map((a) => h("option", { value: a }, a)));
  const number = h("input", { type: "text", class: "input num", autocomplete: "off", placeholder: NUMBER_HINTS.EASA });
  authority.addEventListener("change", () => { number.placeholder = NUMBER_HINTS[authority.value]; });
  const title = h("input", { type: "text", class: "input", maxlength: "200", value: directive ? directive.title : "" });
  const effective = h("input", { type: "text", class: "input num", inputmode: "numeric", placeholder: "YYYY-MM-DD",
    value: dayInLondon(app.state.board?.generated_at ?? Date.now()) });
  const days = h("input", { type: "number", class: "input num", min: "1", max: "3650", step: "1" });
  const fh = h("input", { type: "number", class: "input num", min: "0.1", max: "100000", step: "0.1" });
  const method = h("textarea", { class: "input", rows: "3", maxlength: "4000" });
  const credit = h("input", { type: "checkbox", class: "check" });
  const document_ = h("input", { type: "file", accept: "application/pdf", class: "file" });
  const ranges = h("div", { class: "ranges" });
  const addRange = () => ranges.append(rangeRow((row) => row.remove()));
  addRange();
  const applicability = h("fieldset", { class: "group" }, h("legend", {}, "Applicability"), ranges,
    h("button", { type: "button", class: "btn btn--quiet", onclick: addRange }, "Add range"));
  const submit = h("button", { type: "submit", class: "btn btn--primary" }, "Ingest");
  const cancel = h("button", { type: "button", class: "btn btn--quiet", onclick: () => dlg.close() }, "Cancel");
  const form = h("form", { class: "form form--grid", novalidate: true },
    directive ? null : field("Authority", authority),
    directive ? null : field("Directive number", number, "As published by the authority."),
    field("Title", title), field("Effective date", effective, "YYYY-MM-DD, no later than today."),
    field("Calendar limit in days", days), field("Flight-hours limit", fh), field("Method of compliance", method),
    applicability, field("Directive document", document_, "The directive PDF."),
    directive ? h("label", { class: "check-row" }, credit, " Credit work done under the prior revision") : null,
    h("div", { class: "form__actions" }, submit, cancel));
  dlg.body.append(form);

  const fieldFor = (key) => {
    if (key.startsWith("applicability.")) return ranges.children[Number(key.split(".")[1])]?.inputs.model;
    return { authority, number, title, effective_date: effective, calendar_days: days, fh_interval: fh, method,
      applicability: ranges.children[0]?.inputs.model || applicability.querySelector("button"),
      document_id: document_, document: document_, prior_credit: credit }[key];
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const tag = `R${revision}`;
    const display = directive ? name : `${authority.value} ${number.value.trim()}`;
    const result = await app.run({
      button: submit, pending: `Ingesting ${tag}…`, fieldFor,
      call: async () => {
        let documentId;
        const file = document_.files[0];
        if (file) documentId = (await request("POST", "/api/documents", { raw: file, contentType: "application/pdf" })).body.document_id;
        const num = (v) => (v.value === "" ? null : Number(v.value));
        const body = {
          title: title.value, document_id: documentId ?? null, effective_date: effective.value.trim(),
          calendar_days: num(days), fh_interval: num(fh), method: method.value,
          applicability: [...ranges.children].map((r) => ({ model: r.inputs.model.value || null, msn_from: num(r.inputs.first),
            msn_to: num(r.inputs.last) })),
        };
        if (directive) return request("POST", `/api/directives/${directive.id}/revisions`,
          { json: { ...body, revision, prior_credit: credit.checked } });
        return request("POST", "/api/directives", { json: { ...body, authority: authority.value, number: number.value.trim() } });
      },
      success: () => `${display} ${tag} ingested.`,
      errors: {
        directive_exists: () => `${display} is already on the board.`,
        revision_out_of_order: (err) => `This directive is now at ${err.extra.current}. Reload and try again.`,
        directive_withdrawn: () => `${display} is withdrawn.`,
        storage_unavailable: () => "Document storage is unavailable. Nothing was ingested.",
      },
    });
    if (result) {
      dlg.close();
      app.spliceArrived(result.body.directive.id, result.body.splice, true);
    }
  });
}

export function openWithdrawDialog(app, directive) {
  const name = dname(directive);
  const dlg = modal({ label: `Withdraw ${name}` });
  const reason = h("textarea", { class: "input", rows: "3", maxlength: "500" });
  const submit = h("button", { type: "submit", class: "btn btn--primary" }, "Withdraw");
  const form = h("form", { class: "form", novalidate: true },
    h("p", {}, "The column stays on the board as a placeholder with its full history. Open work and queued notices are withdrawn."),
    field("Withdrawal reason", reason),
    h("div", { class: "form__actions" }, submit,
      h("button", { type: "button", class: "btn btn--quiet", onclick: () => dlg.close() }, "Cancel")));
  dlg.body.append(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const done = await app.run({
      button: submit, pending: "Withdrawing…", fieldFor: (k) => (k === "reason" ? reason : null),
      call: () => request("POST", `/api/directives/${directive.id}/withdrawal`, { json: { reason: reason.value } }),
      success: () => `${name} withdrawn. History kept.`,
      errors: { directive_withdrawn: () => `${name} is withdrawn.` },
    });
    if (done) {
      dlg.close();
      app.refresh();
    }
  });
}

function resultTable(label, columns, rows) {
  return h("table", { class: "table", "aria-label": label },
    h("caption", {}, label),
    h("thead", {}, h("tr", {}, columns.map(([title]) => h("th", { scope: "col", class: title === "Row" ? "num" : "" }, title)))),
    h("tbody", {}, rows.length ? rows.map((r) => h("tr", {}, columns.map(([, key]) =>
      h("td", { class: key === "row" ? "num" : "" }, r[key] ?? "")))) : h("tr", {}, h("td", { colspan: columns.length, class: "muted" }, "None"))));
}

export function openImportDialog(app) {
  const dlg = modal({ label: "Import history", wide: true });
  const file = h("input", { type: "file", accept: ".csv,text/csv", class: "file" });
  const submit = h("button", { type: "submit", class: "btn btn--primary" }, "Import");
  const result = h("section", { role: "region", "aria-label": "Import result", class: "import-result" },
    h("p", { class: "muted" }, "Rows are matched by tail, directive and revision after normalising spelling."));
  const form = h("form", { class: "form", novalidate: true },
    field("History file", file, "UTF-8 CSV with tail, directive, revision, status, inspector, inspector_licence, inspected_on, certifier, certifier_licence, certified_on and notes."),
    h("div", { class: "form__actions" }, submit,
      h("button", { type: "button", class: "btn btn--quiet", onclick: () => dlg.close() }, "Close")), result);
  dlg.body.append(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const chosen = file.files[0];
    if (!chosen) return fieldError(file, "Choose the exported CSV file.");
    const r = await app.run({
      button: submit, pending: "Importing…", fieldFor: (k) => (k === "file" ? file : null),
      call: () => keyed("POST", "/api/imports", { raw: chosen, contentType: "text/csv" },
        { signature: `${chosen.name}:${chosen.size}:${chosen.lastModified}`, onRetry: app.retrying }),
      success: (res) => (res.body.replayed_file ? "This file was already imported. Nothing changed."
        : `Import finished: ${res.body.merged} merged, ${res.body.duplicates} duplicates, ${res.body.orphans.length} orphans, ${res.body.rejected.length} rejected.`),
    });
    if (!r) return;
    const x = r.body;
    result.replaceChildren(
      h("dl", { class: "facts facts--inline" }, ["rows", "merged", "duplicates", "closed"].flatMap((k) =>
        [h("dt", {}, k[0].toUpperCase() + k.slice(1)), h("dd", { class: "num" }, x[k])])),
      resultTable("Orphan rows", [["Row", "row"], ["Tail", "tail"], ["Directive", "directive"], ["Revision", "revision"],
        ["Reason", "reason"]], x.orphans),
      resultTable("Rejected rows", [["Row", "row"], ["Field", "field"], ["Message", "message"]], x.rejected));
    app.refresh();
  });
}

export function openEraseDialog(app, person) {
  const dlg = modal({ label: "Erase contractor" });
  const reason = h("textarea", { class: "input", rows: "3", maxlength: "500" });
  const submit = h("button", { type: "submit", class: "btn btn--primary" }, "Erase");
  const form = h("form", { class: "form", novalidate: true },
    h("p", {}, `${person.display_name}'s name, licence and email are replaced by an anonymised signer token on every surface. Signatures, evidence and audit entries stay.`),
    field("Erasure reason", reason),
    h("div", { class: "form__actions" }, submit,
      h("button", { type: "button", class: "btn btn--quiet", onclick: () => dlg.close() }, "Cancel")));
  dlg.body.append(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const r = await app.run({
      button: submit, pending: "Erasing…", fieldFor: (k) => (k === "reason" ? reason : null),
      call: () => request("POST", `/api/people/${person.id}/erasure`, { json: { reason: reason.value } }),
      success: (res) => `${res.body.person.display_name} now replaces this contractor everywhere.`,
      errors: { not_contractor: () => "Only contractor records can be erased.", already_erased: () => "This person was already erased." },
    });
    if (r) {
      dlg.close();
      app.refresh();
    }
  });
}

export function openScopeDialog(app, engineer) {
  const dlg = modal({ label: `Certification scope ${engineer.display_name}` });
  const boxes = Object.entries(MODEL_LABELS).map(([code, label]) => {
    const box = h("input", { type: "checkbox", class: "check", value: code, checked: (engineer.scope || []).includes(code) });
    return h("label", { class: "check-row" }, box, ` ${label}`);
  });
  const submit = h("button", { type: "submit", class: "btn btn--primary" }, "Save scope");
  const form = h("form", { class: "form", novalidate: true },
    h("fieldset", { class: "group" }, h("legend", {}, "Models this engineer may certify"), boxes),
    h("p", { class: "muted" }, "Inspected threads of a removed model pass to the next engineer on the model's standby list."),
    h("div", { class: "form__actions" }, submit,
      h("button", { type: "button", class: "btn btn--quiet", onclick: () => dlg.close() }, "Cancel")));
  dlg.body.append(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const models = boxes.map((b) => b.querySelector("input")).filter((b) => b.checked).map((b) => b.value);
    const r = await app.run({
      button: submit, pending: "Saving scope…",
      call: () => request("PUT", `/api/engineers/${engineer.id}/scope`, { json: { models } }),
      success: (res) => `Scope saved. ${res.body.succession.length} threads passed on.`,
    });
    if (r) {
      dlg.close();
      app.refresh();
    }
  });
}
