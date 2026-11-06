// Request detail: fields, seats, prep materials, the cancellation window, and the actions its state allows.
import type { PrepFile, Quote, RequestView, SeatView } from "../../shared/api.js";
import { SETTING_LABELS } from "../../shared/domain.js";
import { agencyDate, agencyTime } from "../../shared/time.js";
import { call, get, newKey } from "../api.js";
import type { Screen } from "../app.js";
import { h, replace, say, statusRegion } from "../dom.js";
import { button, dialog, emptyNote, showErrors, when } from "../ui.js";
import { requestForm } from "./request-form.js";

const PRE_START = ["draft", "submitted", "partially_staffed", "staffed"];
const PREP_TYPES = ".pdf,.docx,.pptx,.txt,.png,.jpg,.jpeg,application/pdf,text/plain,image/png,image/jpeg";

const expiry = (iso: string): string => `${agencyDate(new Date(iso))} ${agencyTime(new Date(iso))}`;

export function seatLine(seat: SeatView, total: number): string {
  const label = `Seat ${seat.position} of ${total}`;
  if (seat.status === "open") return `${label}: open`;
  const who = seat.interpreter?.name ?? "";
  const holder = seat.held_by ? `, held by ${seat.held_by.name}` : "";
  if (seat.status === "offered") return `${label}: offered to ${who}${holder}, offer expires ${seat.offer ? expiry(seat.offer.expires_at) : ""}`;
  const sheet = seat.timesheet ? `; timesheet ${seat.timesheet.status}, ${seat.timesheet.billed_hours} billed hours${seat.timesheet.amount ? `, $${seat.timesheet.amount}` : ""}` : "";
  return `${label}: accepted by ${who}${holder}${sheet}`;
}

export function prepList(files: PrepFile[]): HTMLElement[] {
  const list = h(
    "ul",
    { class: "files", "aria-label": "Prep materials" },
    files.map((f) => h("li", {}, h("a", { href: `/api/prep/${f.id}`, download: f.filename }, f.filename))),
  );
  return files.length ? [list] : [list, emptyNote("No prep material yet.")];
}

/** The cancellation window line, from the server's own `in_cancellation_window` and stored fee. */
function windowLine(r: RequestView): string {
  if (r.status === "cancelled_late" || r.status === "cancelled_on_time") return `Cancelled ${r.status === "cancelled_late" ? "late" : "on time"}. Charge: $${r.cancellation_fee ?? "0.00"}.`;
  if (!PRE_START.includes(r.status)) return "This assignment can no longer be cancelled.";
  return r.in_cancellation_window
    ? "Cancelling now is late and is charged per seated interpreter. Cancel request shows the exact charge first."
    : "Cancelling now is on time and free of charge.";
}

export async function requestDetailScreen({ main, user, params, flash }: Screen): Promise<void> {
  const status = statusRegion("Request status");
  const sheet = h("section", { class: "sheet" });
  main.append(sheet);
  const id = params.id ?? "";
  let request: RequestView | null = null;

  const load = async (): Promise<void> => {
    const result = await get<{ request: RequestView }>(`/api/requests/${id}`);
    request = result.ok ? result.data.request : null;
    await draw();
  };

  const upload = h("input", { type: "file", accept: PREP_TYPES, class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
  upload.addEventListener("change", async () => {
    const file = upload.files?.[0];
    upload.value = "";
    if (!file || !request) return;
    say(status, `Uploading ${file.name}…`);
    const form = new FormData();
    form.append("file", file, file.name);
    const result = await call("POST", `/api/requests/${request.id}/prep`, form);
    if (result.ok) {
      await load();
      say(status, `${file.name} attached.`);
      return;
    }
    const copy: Record<string, string> = {
      payload_too_large: `${file.name} is too large.`,
      unsupported_media_type: `${file.name} is not a supported file type.`,
      storage_unavailable: "File storage is unreachable. Nothing was uploaded.",
      invalid_transition: "Prep material can no longer be added to this request.",
    };
    say(status, copy[result.error.code] ?? `${file.name} could not be attached.`);
  });

  const submitRequest = async (): Promise<void> => {
    if (!request) return;
    say(status, "Submitting…");
    const ref = request.ref;
    const result = await call<{ request: RequestView }>("POST", `/api/requests/${request.id}/submit`, {});
    if (result.ok) {
      request = result.data.request;
      await draw();
      say(status, `${ref} submitted to dispatch.`);
      return;
    }
    if (result.error.code === "invalid_transition") {
      await load();
      say(status, "This request can no longer be submitted.");
      return;
    }
    say(status, result.error.code === "validation" ? "Check the highlighted fields." : "The request could not be submitted. Try again.");
  };

  const cancelFlow = async (opener: HTMLElement): Promise<void> => {
    if (!request) return;
    const ref = request.ref;
    const rid = request.id;
    const box = dialog("Cancel request");
    const cancelStatus = statusRegion("Cancellation status", "status dialog-status");
    const confirm = button("Confirm cancellation");
    const keep = button("Keep request", {}, "quiet");
    const actions = h("div", { class: "actions" }, confirm, keep);
    box.body.append(h("p", { class: "fig dialog-ref" }, `${ref} · ${request.title}`), cancelStatus, actions);
    keep.addEventListener("click", () => box.close());
    box.open(opener);
    confirm.disabled = true;
    say(cancelStatus, "Working out the charge…");
    const quoted = await get<{ quote: Quote }>(`/api/requests/${rid}/cancellation-quote`);
    if (!quoted.ok) {
      say(cancelStatus, quoted.error.code === "already_started" ? "This assignment has started and can no longer be cancelled." : "This request can no longer be cancelled.");
      return;
    }
    let quote = quoted.data.quote;
    const quoteCopy = (q: Quote): string => (q.late ? `Late cancellation. $${q.fee} will be charged for ${q.seated} seated interpreter(s).` : "On-time cancellation. No charge.");
    say(cancelStatus, quoteCopy(quote));
    confirm.disabled = false;
    const key = newKey();
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      say(cancelStatus, `Cancelling ${ref}…`);
      const result = await call<{ request: RequestView; quote: Quote }>(
        "POST",
        `/api/requests/${rid}/cancel`,
        { expected_fee: quote.fee, reason: "Cancelled by the requester" },
        { "Idempotency-Key": key },
      );
      if (result.ok) {
        request = result.data.request;
        await draw();
        say(cancelStatus, `${ref} cancelled. Charge: $${result.data.quote.fee}.`);
        replace(actions, button("Close", {}, "quiet"));
        actions.firstElementChild?.addEventListener("click", () => box.close());
        return;
      }
      confirm.disabled = false;
      const error = result.error;
      if (error.code === "fee_changed" && error.quote) {
        quote = error.quote;
        say(cancelStatus, `The charge is now $${quote.fee}. Review it and confirm again.`);
        return;
      }
      const copy: Record<string, string> = {
        billing_unavailable: "Billing is unreachable. The request is not cancelled. Try again in a few minutes.",
        already_started: "This assignment has started and can no longer be cancelled.",
        invalid_transition: "This request can no longer be cancelled.",
      };
      say(cancelStatus, copy[error.code] ?? "The request could not be cancelled. Try again.");
    });
  };

  const draw = async (): Promise<void> => {
    if (!request) {
      replace(sheet, h("h1", {}, "Request not found"), h("p", { class: "lede" }, "There is no request at this address that you can see."));
      return;
    }
    const r = request;
    const requester = user?.role === "requester";
    const actions = h("div", { class: "actions" });
    if (requester && PRE_START.includes(r.status)) {
      const add = button("Add prep file", {}, "quiet");
      add.addEventListener("click", () => upload.click());
      actions.append(add);
    }
    if (requester && r.status === "draft") {
      const submit = button("Submit request");
      submit.addEventListener("click", () => void submitRequest());
      actions.append(submit);
    }
    const started = new Date(r.start).getTime() <= Date.now();
    if ((requester || user?.role === "coordinator") && PRE_START.includes(r.status) && (r.status === "draft" || !started)) {
      const cancel = button("Cancel request", {}, "quiet");
      cancel.addEventListener("click", () => void cancelFlow(cancel));
      actions.append(cancel);
    }
    const facts: [string, string][] = [
      ["When", when(r.start, r.end)],
      ["Setting", SETTING_LABELS[r.setting]],
      ["Organisation", r.org_name],
      ["Location", r.location],
      ["Deaf consumer", r.consumer.name],
      ["Notes", r.notes || "None"],
    ];
    replace(
      sheet,
      h("p", { class: "eyebrow fig" }, r.ref),
      h("h1", {}, r.title),
      h(
        "p",
        { class: "state-line" },
        "Status ",
        h("span", { class: "state" }, r.status),
        " · Seats ",
        h("span", { class: "fig" }, `${r.seats_accepted}/${r.seats_total}`),
        " accepted",
        r.logged_after ? " · logged after the fact" : "",
      ),
      h("dl", { class: "facts" }, facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
      h("p", { class: `window-line${r.in_cancellation_window ? " is-late" : ""}` }, r.in_cancellation_window ? h("span", { class: "window-mark" }, "In cancellation window") : null, " ", windowLine(r)),
      h("h2", {}, "Seats"),
      h("ul", { class: "seats", "aria-label": "Seats" }, r.seats.map((s) => h("li", { "data-state": s.status }, seatLine(s, r.seats_total)))),
      h("h2", {}, "Prep materials"),
      ...prepList(r.prep_files),
      actions,
      upload,
      status,
    );
    if (requester && r.status === "draft") {
      const edit = await requestForm("Edit draft", r, "Save draft");
      edit.form.addEventListener("submit", async (event) => {
        event.preventDefault();
        say(status, "Saving…");
        const result = await call<{ request: RequestView }>("PATCH", `/api/requests/${r.id}`, edit.body());
        if (result.ok) {
          request = result.data.request;
          await draw();
          say(status, `Draft ${result.data.request.ref} saved.`);
          return;
        }
        showErrors(edit.fields, result.error.fields);
        say(status, result.error.code === "validation" ? "Check the highlighted fields." : "The draft could not be saved. Try again.");
      });
      sheet.append(h("h2", {}, "Edit draft"), edit.form);
    }
  };

  await load();
  if (flash) say(status, flash);
}
