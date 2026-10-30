import type { Loan, Photo, PhotoStage } from "../../shared/api.js";
import { addDays, instantFromLocalInput, localInputValue } from "../../shared/calendar.js";
import { lastRenewalDate } from "../../shared/windows.js";
import { FIELD_COPY, PHOTO_UNAVAILABLE, receiptLines } from "../../shared/copy.js";
import { billingAmount, centsFromDollarInput, formatMoney } from "../../shared/money.js";
import { ApiFailure, get, messageOf, post, request, withRetryKey } from "../api.js";
import { openDialog, type OpenDialog } from "../dialog.js";
import { h, icon, label, loadingLine, statusRegion, uid } from "../dom.js";
import { currentUser, isStaff, library, localTime } from "../session.js";
import { loanChip } from "../status.js";
import { fieldError, plainButton, primaryButton, setPending, showFieldErrors } from "./forms.js";
import { notFoundView } from "./notfound.js";

const STAGE_TITLE: Record<PhotoStage, string> = { checkout: "Checkout", return: "Return" };

function photoPanel(loan: Loan, stage: PhotoStage): HTMLElement {
  const titleId = uid(`${stage}-photos`);
  const photos = loan.photos.filter((photo: Photo) => photo.stage === stage);
  const grid = h("ul", { class: "photos__grid" });
  photos.forEach((photo, i) => {
    const name = `${STAGE_TITLE[stage]} photo ${i + 1}`;
    const img = h("img", { src: photo.url, alt: name, loading: "lazy", decoding: "async", width: "320", height: "240" });
    img.addEventListener("error", () => img.replaceWith(h("div", { class: "photo-missing", role: "img", "aria-label": name }, PHOTO_UNAVAILABLE)));
    grid.append(h("li", { class: "photos__item" }, img, h("span", { class: "label photos__caption" }, `Photo ${i + 1}`)));
  });
  return h(
    "section",
    { class: "box photos", "aria-labelledby": titleId },
    h("div", { class: "box__head" }, h("h2", { id: titleId }, `${STAGE_TITLE[stage]} photos`), h("p", { class: "label" }, `${photos.length} ${photos.length === 1 ? "photo" : "photos"} · up to 4`)),
    photos.length ? grid : h("p", { class: "photos__empty label" }, "No photos yet"),
  );
}

function fact(name: string, ...value: (Node | string | null)[]): HTMLDivElement {
  return h("div", { class: "fact" }, h("dt", { class: "label" }, name), h("dd", null, ...value));
}

export function loanView(root: HTMLElement, loanId: string): () => void {
  let active = true;
  const user = currentUser();
  const staff = isStaff(user?.role);
  const founder = user?.role === "founder";
  const counterResult = statusRegion("Counter result");
  const renewalResult = statusRegion("Renewal result");
  const settlementResult = statusRegion("Settlement result");
  const page = h("div", { class: "loan" }, loadingLine());
  root.append(page);
  let loan: Loan | null = null;

  const reread = async (): Promise<void> => {
    const fresh = await get<{ loan: Loan }>(`/api/loans/${encodeURIComponent(loanId)}`);
    if (!active) return;
    loan = fresh.loan;
    render();
  };

  const keepFocus = (fallback: HTMLElement | null) => {
    if (document.activeElement === document.body || !document.activeElement?.isConnected) fallback?.focus();
  };

  function renewalControls(current: Loan): HTMLElement {
    const id = uid("new-due");
    const input = h("input", { id, type: "date", min: addDays(current.due_date, 1), max: lastRenewalDate(current.due_date) });
    const error = fieldError(input);
    const button = primaryButton("Renew");
    button.addEventListener("click", async () => {
      if (button.classList.contains("is-pending")) return;
      setPending(button, "Renewing…");
      showFieldErrors({}, { due_date: error });
      try {
        const result = await withRetryKey(`renew:${current.id}:${input.value}`, (key) =>
          post<{ loan: Loan }>(`/api/loans/${current.id}/renewal`, { due_date: input.value }, key),
        );
        if (!active) return;
        loan = result.loan;
        renewalResult.textContent = `Renewed. Due ${localTime(result.loan.due_at)}.`;
        render();
        keepFocus(page.querySelector<HTMLElement>("#loan-due"));
      } catch (error_) {
        renewalResult.textContent = messageOf(error_);
        if (error_ instanceof ApiFailure) showFieldErrors(error_.fields, { due_date: error });
        setPending(button, null);
      }
    });
    return h(
      "div",
      { class: "renewal" },
      h("div", { class: "field" }, h("label", { for: id, class: "label" }, "New due date"), input, error),
      button,
    );
  }

  function photoControls(current: Loan): HTMLElement {
    const id = uid("photo");
    const input = h("input", { id, type: "file", accept: "image/jpeg,image/png,image/webp", class: "file-input" });
    const error = fieldError(input);
    const button = plainButton("Add photo");
    button.prepend(icon("camera"));
    button.addEventListener("click", async () => {
      if (button.classList.contains("is-pending")) return;
      const file = input.files?.[0];
      showFieldErrors({}, { photo: error });
      if (!file) {
        showFieldErrors({ photo: FIELD_COPY.required }, { photo: error });
        counterResult.textContent = "Check the highlighted fields.";
        return;
      }
      setPending(button, "Uploading photo…");
      const form = new FormData();
      form.append("photo", file);
      try {
        await request("POST", `/api/loans/${current.id}/photos`, { form });
        counterResult.textContent = "Photo saved.";
      } catch (error_) {
        counterResult.textContent = messageOf(error_);
        if (error_ instanceof ApiFailure) showFieldErrors(error_.fields, { photo: error });
      }
      setPending(button, null);
      if (active) {
        await reread();
        keepFocus(page.querySelector<HTMLElement>(".file-input"));
      }
    });
    return h(
      "div",
      { class: "desk__step" },
      h("h3", null, "Condition photos"),
      h("p", { class: "desk__hint" }, current.status === "returned" ? "Photos added now go under Return photos." : "Photos added now go under Checkout photos."),
      h("div", { class: "field" }, h("label", { for: id, class: "label" }, "Condition photo"), input, error),
      button,
    );
  }

  function checkInControls(current: Loan): HTMLElement {
    const id = uid("returned-at");
    const input = h("input", { id, type: "datetime-local", value: localInputValue(new Date(), library().time_zone) });
    const error = fieldError(input);
    const button = primaryButton("Check in");
    button.addEventListener("click", async () => {
      if (button.classList.contains("is-pending")) return;
      setPending(button, "Checking in…");
      showFieldErrors({}, { returned_at: error });
      const instant = input.value ? instantFromLocalInput(input.value, library().time_zone) : null;
      try {
        const result = await post<{ loan: Loan }>(`/api/loans/${current.id}/return`, instant ? { returned_at: instant.toISOString() } : {});
        if (!active) return;
        loan = result.loan;
        counterResult.textContent = result.loan.on_time ? "Checked in on time." : `Checked in late: ${result.loan.late_days ?? 0} late days.`;
        render();
        keepFocus(page.querySelector<HTMLElement>(".file-input"));
      } catch (error_) {
        counterResult.textContent = messageOf(error_);
        if (error_ instanceof ApiFailure) showFieldErrors(error_.fields, { returned_at: error });
        setPending(button, null);
        if (error_ instanceof ApiFailure && error_.status === 409) await reread();
      }
    });
    return h(
      "div",
      { class: "desk__step" },
      h("h3", null, "Check in"),
      h("div", { class: "field" }, h("label", { for: id, class: "label" }, "Returned at"), input, error),
      button,
    );
  }

  function inspectionControls(current: Loan): HTMLElement {
    const groupId = uid("condition");
    const noteId = uid("note");
    const radio = (value: "ok" | "damaged", text: string) => {
      const id = uid(`condition-${value}`);
      return h("label", { class: "radio", for: id }, h("input", { id, type: "radio", name: groupId, value }), h("span", null, text));
    };
    const group = h(
      "div",
      { role: "radiogroup", "aria-labelledby": `${groupId}-label`, class: "radios", id: groupId },
      radio("ok", "OK"),
      radio("damaged", "Damaged"),
    );
    const outcomeError = fieldError(group);
    const note = h("textarea", { id: noteId, rows: "3", maxlength: "500" });
    const noteError = fieldError(note);
    const button = primaryButton("Save inspection");
    button.addEventListener("click", async () => {
      if (button.classList.contains("is-pending")) return;
      setPending(button, "Saving…");
      const lines = { outcome: outcomeError, note: noteError };
      showFieldErrors({}, lines);
      const outcome = group.querySelector<HTMLInputElement>("input:checked")?.value ?? "";
      try {
        const result = await post<{ loan: Loan }>(`/api/loans/${current.id}/inspection`, { outcome, note: note.value });
        if (!active) return;
        loan = result.loan;
        counterResult.textContent = "Inspection saved.";
        render();
        keepFocus(page.querySelector<HTMLElement>(".settle-button") ?? page.querySelector<HTMLElement>("h1"));
      } catch (error_) {
        counterResult.textContent = messageOf(error_);
        if (error_ instanceof ApiFailure) showFieldErrors(error_.fields, lines);
        setPending(button, null);
        if (error_ instanceof ApiFailure && error_.status === 409) await reread();
      }
    });
    return h(
      "div",
      { class: "desk__step" },
      h("h3", null, "Inspection"),
      h("p", { id: `${groupId}-label`, class: "label" }, "Condition"),
      group,
      outcomeError,
      h("div", { class: "field" }, h("label", { for: noteId, class: "label" }, "Inspection note"), note, noteError),
      button,
    );
  }

  let dialog: OpenDialog | null = null;

  function settleControls(current: Loan): HTMLElement {
    const opener = primaryButton("Settle", { class: "button button--primary settle-button" });
    const chargeId = uid("damage");
    const titleId = uid("settle-title");
    const charge = h("input", { id: chargeId, type: "text", inputmode: "decimal", autocomplete: "off", value: billingAmount(0) });
    const chargeError = fieldError(charge);
    const message = h("p", { class: "dialog__message", role: "alert" });
    const confirm = primaryButton("Confirm settlement");
    const cancel = plainButton("Cancel");
    const box = h(
      "dialog",
      { class: "dialog box", "aria-labelledby": titleId },
      h("h2", { id: titleId }, "Settle loan"),
      h("p", { class: "money-line" }, label("Deposit held"), " ", h("span", { class: "money" }, formatMoney(current.deposit_cents))),
      h("p", { class: "money-line" }, label("Replacement"), " ", h("span", { class: "money" }, formatMoney(current.replacement_cents))),
      h("div", { class: "field" }, h("label", { for: chargeId, class: "label" }, "Damage charge"), h("div", { class: "dollar-input" }, h("span", { "aria-hidden": "true" }, "$"), charge), chargeError),
      message,
      h("div", { class: "dialog__actions" }, confirm, cancel),
    );
    opener.addEventListener("click", () => {
      charge.value = billingAmount(0);
      message.textContent = "";
      showFieldErrors({}, { damage_cents: chargeError });
      dialog = openDialog(box, opener, charge);
    });
    cancel.addEventListener("click", () => dialog?.close());
    confirm.addEventListener("click", async () => {
      if (confirm.classList.contains("is-pending")) return;
      const cents = centsFromDollarInput(charge.value);
      showFieldErrors({}, { damage_cents: chargeError });
      if (cents === null) {
        showFieldErrors({ damage_cents: FIELD_COPY.damage }, { damage_cents: chargeError });
        settlementResult.textContent = message.textContent = "Check the highlighted fields.";
        return;
      }
      setPending(confirm, "Settling…");
      try {
        const result = await withRetryKey(`settle:${current.id}:${cents}`, (key) =>
          post<{ loan: Loan }>(`/api/loans/${current.id}/settlement`, { damage_cents: cents }, key),
        );
        if (!active) return;
        dialog?.close();
        loan = result.loan;
        settlementResult.textContent = `Settled. Receipt queued for ${result.loan.member.name}.`;
        render();
        page.querySelector<HTMLElement>(".receipt")?.focus();
      } catch (error_) {
        settlementResult.textContent = message.textContent = messageOf(error_);
        if (error_ instanceof ApiFailure) showFieldErrors(error_.fields, { damage_cents: chargeError });
        setPending(confirm, null);
      }
    });
    return h("div", { class: "settle" }, h("p", { class: "desk__hint" }, "Compare the photos, then settle the deposit and any late fee."), opener, box);
  }

  function render(): void {
    if (!loan) return;
    const current = loan;
    const mine = user?.id === current.member.id;
    const renewable = current.status === "out" && current.renewed_at === null && (mine || staff);
    const canPhoto = staff && ["out", "overdue", "returned"].includes(current.status);

    const facts = h(
      "dl",
      { class: "facts" },
      fact("Status", loanChip(current.status)),
      fact("Borrower", current.member.name),
      fact("Checked out", h("span", { class: "mono" }, localTime(current.checked_out_at))),
      fact(
        "Due",
        h("span", { class: "mono", id: "loan-due", tabindex: "-1" }, localTime(current.due_at)),
        current.renewed_at ? h("span", { class: "tag" }, "renewed") : null,
      ),
      fact(
        "Returned",
        current.returned_at ? h("span", { class: "mono" }, localTime(current.returned_at)) : "Not yet",
        current.returned_at ? h("span", { class: "tag" }, current.on_time ? "on time" : `${current.late_days ?? 0} late days`) : null,
      ),
      fact("Deposit", h("span", { class: "money" }, current.deposit_cents > 0 ? formatMoney(current.deposit_cents) : "No deposit")),
    );

    const desk = staff
      ? h(
          "section",
          { class: "box desk", "aria-labelledby": "desk-title" },
          h("div", { class: "box__head" }, h("h2", { id: "desk-title", tabindex: "-1" }, "Counter desk")),
          counterResult,
          current.status === "out" || current.status === "overdue" ? checkInControls(current) : null,
          canPhoto ? photoControls(current) : null,
          current.status === "returned" ? inspectionControls(current) : null,
          current.status === "inspected" || current.status === "settled" ? h("p", { class: "desk__hint" }, "Checked in and inspected.") : null,
        )
      : null;

    const renewal = renewable
      ? h(
          "section",
          { class: "box renewal-box", "aria-labelledby": "renewal-title" },
          h("div", { class: "box__head" }, h("h2", { id: "renewal-title" }, "Renewal")),
          h("p", { class: "desk__hint" }, "One renewal of up to 7 days, if nobody else has the unit booked."),
          renewalControls(current),
          renewalResult,
        )
      : null;

    const inspection = current.inspection
      ? h(
          "section",
          { class: "box inspection", "aria-labelledby": "inspection-title" },
          h("div", { class: "box__head" }, h("h2", { id: "inspection-title" }, "Inspection")),
          h("p", null, label(current.inspection.outcome === "ok" ? "OK" : "Damaged"), " ", current.inspection.note || "No note."),
          h("p", { class: "mono desk__hint" }, `Recorded ${localTime(current.inspection.inspected_at)}`),
          founder && current.status === "inspected" ? settleControls(current) : null,
          founder ? settlementResult : null,
        )
      : null;

    const receipt = current.settlement
      ? h(
          "section",
          { class: "box receipt", "aria-labelledby": "receipt-title", tabindex: "-1" },
          h("div", { class: "box__head" }, h("h2", { id: "receipt-title" }, "Receipt")),
          h("ul", { class: "receipt__lines mono" }, receiptLines(current.settlement).map((line) => h("li", null, line))),
        )
      : null;

    page.replaceChildren(
      h("div", { class: "page-head" }, h("p", { class: "label" }, "Loan"), h("h1", null, `${current.item.name}, unit ${current.unit.label}`)),
      h(
        "div",
        { class: `grid loan-layout${renewal || desk ? "" : " loan-layout--single"}` },
        h("section", { class: "box loan__facts", "aria-label": "Loan details" }, facts, mine || staff ? (renewal ? null : renewalResult) : null),
        renewal || desk ? h("div", { class: "loan__actions" }, renewal, desk) : null,
      ),
      h("div", { class: "grid photos-pair" }, photoPanel(current, "checkout"), photoPanel(current, "return")),
    );
    if (inspection) page.append(inspection);
    if (receipt) page.append(receipt);
  }

  void reread().catch((error: unknown) => {
    if (!active) return;
    if (error instanceof ApiFailure && error.status === 404) {
      root.replaceChildren();
      notFoundView(root);
      return;
    }
    page.replaceChildren(h("p", { class: "result" }, messageOf(error)));
  });

  return () => {
    active = false;
    dialog?.close();
  };
}
