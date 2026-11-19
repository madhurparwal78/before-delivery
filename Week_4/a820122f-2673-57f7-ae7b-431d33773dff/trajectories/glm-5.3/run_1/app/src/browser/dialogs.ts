import { el } from "./api.js";

/**
 * Dialogs: focus moves in on open, Tab and Shift+Tab stay inside, Escape
 * closes without saving, closing returns focus to the control that opened
 * it, and Enter in a text field submits.
 */

interface DialogSpec {
  label: string;
  fields: { name: string; type: "text" | "textarea" | "select"; options?: string[]; value?: string }[];
  submitLabel: string;
  text?: string;
  confirmOnly?: boolean;
}

export interface DialogResult {
  action: "submit" | "cancel";
  values: Record<string, string>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openDialog(spec: DialogSpec, opener: HTMLElement, onSubmit: (values: Record<string, string>) => Promise<string | void>): void {
  const previous = document.querySelector("dialog[open]") as HTMLDialogElement | null;
  if (previous) previous.close();

  const dialog = el("dialog", { "aria-label": spec.label });
  const title = el("h3", {}, spec.label);
  dialog.append(title);
  if (spec.text) dialog.append(el("p", { class: "small" }, spec.text));

  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
  if (!spec.confirmOnly) {
    const form = el("form", { class: "dialog-form" });
    for (const field of spec.fields) {
      const label = el("label", { for: `dlg-${field.name}` }, fieldNameLabel(field.name));
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (field.type === "textarea") {
        input = el("textarea", { id: `dlg-${field.name}`, name: field.name, rows: "3" });
      } else if (field.type === "select") {
        const select = el("select", { id: `dlg-${field.name}`, name: field.name });
        for (const option of field.options ?? []) {
          select.append(el("option", { value: option }, option));
        }
        input = select;
      } else {
        input = el("input", { id: `dlg-${field.name}`, name: field.name, type: "text" });
      }
      if (field.value !== undefined) (input as HTMLInputElement).value = field.value;
      label.setAttribute("for", `dlg-${field.name}`);
      form.append(label, input);
      inputs.set(field.name, input);
    }
    dialog.append(form);
  }

  const statusLine = el("p", { class: "field-error", role: "alert" });
  // The submit button sits inside the form so Enter in any field and the
  // button itself submit the same way.
  const row = el("div", { class: "dialog-row" });
  const cancelButton = el("button", { type: "button" }, "Cancel");
  const submitButton = el("button", { type: "submit", class: "primary" }, spec.submitLabel);
  row.append(cancelButton, submitButton);
  const fieldsForm = dialog.querySelector("form");
  if (fieldsForm) {
    fieldsForm.append(statusLine, row);
  } else {
    const confirmForm = el("form", {}, statusLine, row);
    dialog.append(confirmForm);
  }
  document.body.append(dialog);

  const close = (): void => {
    dialog.close();
    dialog.remove();
    opener.focus();
  };

  const submit = async (): Promise<void> => {
    const values: Record<string, string> = {};
    for (const [name, input] of inputs) {
      values[name] = input instanceof HTMLSelectElement ? input.value : (input as HTMLInputElement).value;
    }
    if (spec.confirmOnly) {
      const message = await onSubmit({});
      if (message) {
        statusLine.textContent = message;
        return;
      }
      close();
      return;
    }
    submitButton.textContent = "Saving.";
    try {
      const message = await onSubmit(values);
      if (message) {
        submitButton.textContent = spec.submitLabel;
        statusLine.textContent = message;
        return;
      }
      close();
    } catch (error) {
      submitButton.textContent = spec.submitLabel;
      statusLine.textContent = errorMessage(error);
    }
  };

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  dialog.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });
  dialog.addEventListener("close", () => {
    if (dialog.parentNode) dialog.remove();
    if (document.activeElement === document.body) opener.focus();
  });
  cancelButton.addEventListener("click", () => close());

  dialog.showModal();
  const firstField = dialog.querySelector<HTMLElement>(FOCUSABLE);
  const target = inputs.size > 0 ? inputs.values().next().value as HTMLElement : firstField;
  (target ?? submitButton).focus();
}

function fieldNameLabel(name: string): string {
  const labels: Record<string, string> = {
    name: "Name",
    rank: "Rank",
    email: "Email",
    passcode: "Passcode",
    "vessel-name": "Vessel name",
    kind: "Vessel type",
    "initial-offset": "Starting offset in minutes",
    "changes-at": "Change time in UTC",
    "new-offset": "New offset in minutes",
    latitude: "Latitude",
    longitude: "Longitude",
    "at-utc": "Fix time in UTC",
    "crew-id": "Crew member",
    label: "Watch name",
    "start-time": "Start time",
    "end-time": "End time",
    "from-date": "First ship's date",
    "to-date": "Last ship's date",
    "effective-from": "Starts in UTC",
    "effective-until": "Ends in UTC",
    "flag-reference": "Flag authorisation",
    "start-utc": "Start in UTC",
    "end-utc": "End in UTC",
    description: "What happened",
    type: "Type",
    note: "Note",
    "from-ship-date": "From ship's date",
    "to-ship-date": "To ship's date",
    expires: "Expires in UTC",
  };
  return labels[name] ?? name;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiErrorMessage) return error.message;
  if (error instanceof Error && error.name === "TypeError") return "Something went wrong. Try again.";
  return "Something went wrong. Try again.";
}

export class ApiErrorMessage extends Error {}

/** Map an API error's field messages to a single sentence for dialog display. */
export function firstFieldError(error: unknown): string {
  if (error && typeof error === "object" && "fieldErrors" in error) {
    const fields = (error as { fieldErrors?: Record<string, string> }).fieldErrors;
    if (fields) {
      const first = Object.values(fields)[0];
      if (first) return first;
    }
  }
  return errorMessage(error);
}
