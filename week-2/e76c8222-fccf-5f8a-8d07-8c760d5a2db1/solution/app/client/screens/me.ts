// My work: an interpreter's open offers, accepted assignments (prep, timesheets) and credentials.
import type { Assignments, CredentialView, RequestView } from "../../shared/api.js";
import { CREDENTIAL_TYPES } from "../../shared/domain.js";
import { agencyDate, agencyInput, agencyTime, fromAgencyInput } from "../../shared/time.js";
import { call, get, newKey } from "../api.js";
import type { Screen } from "../app.js";
import { h, replace, say, statusRegion, uid } from "../dom.js";
import { button, dialog, emptyNote, field, select, showErrors, textInput, when } from "../ui.js";

function region(title: string): { section: HTMLElement; body: HTMLDivElement } {
  const id = uid("region");
  const body = h("div", {});
  const section = h("section", { class: "block", "aria-labelledby": id }, h("h2", { id }, title), body);
  return { section, body };
}

export async function meScreen({ main, user }: Screen): Promise<void> {
  const offers = region("My offers");
  const assignments = region("My assignments");
  const credentials = region("My credentials");
  const sections = [offers.section, assignments.section, credentials.section];
  // The three regions appear together once both loads land, so nothing moves under the pointer.
  for (const section of sections) section.hidden = true;
  main.append(h("section", { class: "sheet" }, h("h1", {}, "My work"), h("p", { class: "lede" }, user?.name ?? ""), ...sections));

  const loadWork = async (): Promise<void> => {
    const result = await get<Assignments>("/api/interpreters/me/assignments");
    if (!result.ok) return;
    const { offers: open, assignments: jobs } = result.data;
    replace(
      offers.body,
      open.length
        ? h(
            "ul",
            { class: "rows" },
            open.map((o) =>
              h(
                "li",
                {},
                h("span", { class: "fig" }, o.request.ref),
                ` ${o.request.title} · `,
                h("span", { class: "fig" }, when(o.request.start, o.request.end)),
                ` · seat ${o.seat.position} of ${o.seat.total} · answer by `,
                h("span", { class: "fig" }, `${agencyDate(new Date(o.expires_at))} ${agencyTime(new Date(o.expires_at))}`),
                " ",
                h("a", { href: `/offers/${o.token}` }, `Open offer ${o.request.ref}`),
              ),
            ),
          )
        : emptyNote("No open offers."),
    );
    replace(assignments.body, jobs.length ? h("ul", { class: "rows" }, jobs.map((r) => assignmentRow(r))) : emptyNote("No accepted assignments."));
  };

  const assignmentRow = (r: RequestView): HTMLElement => {
    const seat = r.seats.find((s) => s.status === "accepted" && s.interpreter?.id === user?.id);
    const ended = new Date(r.end).getTime() <= Date.now();
    let sheet: HTMLElement | string = "The timesheet opens after the scheduled end.";
    if (seat?.timesheet) sheet = `Timesheet ${seat.timesheet.status}: ${seat.timesheet.billed_hours} billed hours.`;
    else if (seat && ended) {
      const open = button(`Submit timesheet`, { "aria-label": `Submit timesheet for ${r.ref}` });
      open.addEventListener("click", () => timesheetDialog(r, seat.id, open));
      sheet = open;
    }
    return h(
      "li",
      { class: "assignment" },
      h("p", {}, h("span", { class: "fig" }, r.ref), ` ${r.title}`),
      h("p", { class: "meta" }, h("span", { class: "fig" }, when(r.start, r.end)), ` · ${r.location} · ${r.org_name}`),
      r.prep_files.length
        ? h("ul", { class: "files", "aria-label": `Prep files for ${r.ref}` }, r.prep_files.map((f) => h("li", {}, h("a", { href: `/api/prep/${f.id}`, download: f.filename }, f.filename))))
        : h("p", { class: "meta" }, "No prep files."),
      h("div", { class: "actions" }, sheet),
    );
  };

  const timesheetDialog = (r: RequestView, seatId: string, opener: HTMLElement): void => {
    const box = dialog(`Timesheet for ${r.ref}`);
    const fields = {
      actual_start: field("Actual start", textInput({ inputmode: "numeric" }), "Agency time as YYYY-MM-DDTHH:MM."),
      actual_end: field("Actual end", textInput({ inputmode: "numeric" })),
      signature_name: field("Signature name", textInput({ autocomplete: "name" }), "Type your full name to sign."),
    };
    fields.actual_start.control.value = agencyInput(new Date(r.start));
    fields.actual_end.control.value = agencyInput(new Date(r.end));
    const status = statusRegion("Timesheet status", "status dialog-status");
    const submit = h("button", { type: "submit", class: "button primary" }, "Sign and submit");
    const close = button("Close", {}, "quiet");
    close.addEventListener("click", () => box.close());
    const form = h("form", { class: "stack", novalidate: true }, fields.actual_start.wrap, fields.actual_end.wrap, fields.signature_name.wrap, status, h("div", { class: "actions" }, submit, close));
    const key = newKey();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const iso = (text: string): string => fromAgencyInput(text)?.toISOString() ?? text;
      say(status, "Submitting timesheet…");
      submit.disabled = true;
      const result = await call<{ timesheet: { billed_hours: string } }>(
        "POST",
        `/api/seats/${seatId}/timesheet`,
        { actual_start: iso(fields.actual_start.control.value), actual_end: iso(fields.actual_end.control.value), signature_name: fields.signature_name.control.value },
        { "Idempotency-Key": key },
      );
      if (result.ok) {
        showErrors(fields);
        say(status, `Timesheet for ${r.ref} submitted: ${result.data.timesheet.billed_hours} billed hours.`);
        submit.remove();
        void loadWork();
        return;
      }
      submit.disabled = false;
      showErrors(fields, result.error.fields);
      const copy: Record<string, string> = {
        validation: "Check the highlighted fields.",
        not_yet_ended: "You can submit after the assignment ends.",
        already_submitted: "A timesheet was already submitted for this assignment.",
        invalid_transition: "This assignment was cancelled, so no timesheet can be submitted.",
      };
      say(status, copy[result.error.code] ?? "The timesheet could not be submitted. Try again.");
    });
    box.body.append(form);
    box.open(opener);
  };

  const loadCredentials = async (): Promise<void> => {
    const result = await get<{ credentials: CredentialView[] }>("/api/interpreters/me/credentials");
    const add = button("Add credential", {}, "quiet");
    add.addEventListener("click", () => credentialDialog(add));
    const list = result.ok ? result.data.credentials : [];
    replace(
      credentials.body,
      list.length
        ? h(
            "table",
            { class: "table", "aria-label": "Credentials" },
            h("thead", {}, h("tr", {}, ["Type", "Number", "Expires on", "Status", "Scan"].map((c) => h("th", { scope: "col" }, c)))),
            h(
              "tbody",
              {},
              list.map((c) =>
                h(
                  "tr",
                  {},
                  h("td", { "data-label": "Type", class: "fig" }, c.type),
                  h("td", { "data-label": "Number", class: "fig" }, c.number),
                  h("td", { "data-label": "Expires on", class: "fig" }, c.expires_on),
                  h("td", { "data-label": "Status" }, h("span", { class: "state" }, c.status)),
                  h("td", { "data-label": "Scan" }, h("a", { href: `/api/credentials/${c.id}/scan`, download: "" }, `Scan of ${c.number}`)),
                ),
              ),
            ),
          )
        : emptyNote("No credentials on file."),
      h("div", { class: "actions" }, add),
    );
  };

  const credentialDialog = (opener: HTMLElement): void => {
    const box = dialog("Add credential");
    const fields = {
      type: field("Credential type", select(CREDENTIAL_TYPES.map((t) => [t, t]), "Choose a type")),
      number: field("Credential number", textInput({ maxlength: "40" })),
      expires_on: field("Expires on", textInput({ inputmode: "numeric", placeholder: "2027-06-30" }), "The last valid day, as YYYY-MM-DD."),
    };
    const scanInput = h("input", { type: "file", accept: ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
    const chosen = h("p", { class: "field-hint" }, "No scan chosen.");
    const scanError = h("p", { class: "field-error" });
    const choose = button("Choose scan", {}, "quiet");
    choose.addEventListener("click", () => scanInput.click());
    scanInput.addEventListener("change", () => {
      chosen.textContent = scanInput.files?.[0] ? `Scan: ${scanInput.files[0].name}` : "No scan chosen.";
    });
    const status = statusRegion("Credential status", "status dialog-status");
    const save = h("button", { type: "submit", class: "button primary" }, "Save credential");
    const close = button("Close", {}, "quiet");
    close.addEventListener("click", () => box.close());
    const form = h(
      "form",
      { class: "stack", novalidate: true },
      fields.type.wrap,
      fields.number.wrap,
      fields.expires_on.wrap,
      h("div", { class: "field" }, choose, scanInput, chosen, scanError),
      status,
      h("div", { class: "actions" }, save, close),
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData();
      data.append("type", fields.type.control.value);
      data.append("number", fields.number.control.value);
      data.append("expires_on", fields.expires_on.control.value);
      const scan = scanInput.files?.[0];
      if (scan) data.append("scan", scan, scan.name);
      say(status, "Saving credential…");
      save.disabled = true;
      const result = await call<{ credential: CredentialView }>("POST", "/api/interpreters/me/credentials", data);
      save.disabled = false;
      scanError.textContent = result.ok ? "" : (result.error.fields?.scan ?? "");
      if (result.ok) {
        showErrors(fields);
        say(status, `${result.data.credential.type} saved, valid through ${result.data.credential.expires_on}.`);
        save.remove();
        void loadCredentials();
        return;
      }
      showErrors(fields, result.error.fields);
      const copy: Record<string, string> = {
        validation: "Check the highlighted fields.",
        storage_unavailable: "File storage is unreachable. Nothing was saved.",
        unsupported_media_type: `${scan?.name ?? "That file"} is not a supported file type. Use a PDF, PNG or JPEG scan.`,
        payload_too_large: `${scan?.name ?? "That file"} is too large.`,
      };
      say(status, copy[result.error.code] ?? "The credential could not be saved. Try again.");
    });
    box.body.append(form);
    box.open(opener);
  };

  await Promise.all([loadWork(), loadCredentials()]);
  for (const section of sections) section.hidden = false;
}
