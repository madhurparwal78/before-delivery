/** The Pin event and Delete pass dialogs. */

import { formatMetLabel, parseMetLabel } from "../shared/met.js";
import { consoleCopy, fieldErrors } from "../shared/copy.js";
import type { MissionEvent } from "../shared/model.js";
import { el, fieldError, trapFocus } from "./dom.js";
import { request, requestKey } from "./api.js";

type PinOptions = {
  metLabel: string;
  apiBase: string;
  status: (message: string) => void;
  onSaved: (event: MissionEvent) => void;
  onClosed: () => void;
};

/** One opening creates at most one event: its request key is fixed here. */
export function openPinEventDialog(options: PinOptions): void {
  const key = requestKey();
  const heading = el("h2", { id: "pin-heading", text: `Pin at ${options.metLabel}` });
  const metInput = el("input", {
    id: "pin-met",
    type: "text",
    class: "text mono",
    "aria-label": "MET",
    value: options.metLabel,
  });
  const titleInput = el("input", {
    id: "pin-title",
    type: "text",
    class: "text",
    "aria-label": "Title",
  });
  const noteInput = el("input", {
    id: "pin-note",
    type: "text",
    class: "text",
    "aria-label": "Private note",
  });
  const save = el("button", { type: "submit", class: "primary", text: "Save event" });
  const cancel = el("button", { type: "button", text: "Cancel" });
  const form = el("form", { class: "dialog-body" }, [
    heading,
    el("label", { for: "pin-met", text: "MET" }),
    metInput,
    el("label", { for: "pin-title", text: "Title" }),
    titleInput,
    el("label", { for: "pin-note", text: "Private note" }),
    noteInput,
    el("div", { class: "dialog-actions" }, [save, cancel]),
  ]);
  const dialog = el(
    "div",
    { role: "dialog", "aria-modal": "true", "aria-label": "Pin event", class: "dialog" },
    [form],
  );
  const backdrop = el("div", { class: "backdrop" }, [dialog]);
  document.body.append(backdrop);
  titleInput.focus();

  const close = (): void => {
    backdrop.remove();
    options.onClosed();
  };

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(dialog, event);
  });
  cancel.addEventListener("click", () => close());

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });

  const submit = async (): Promise<void> => {
    fieldError(metInput, null);
    fieldError(titleInput, null);
    fieldError(noteInput, null);
    const met = parseMetLabel(metInput.value.trim());
    if (met === null) {
      fieldError(metInput, fieldErrors.met);
      metInput.focus();
      return;
    }
    heading.textContent = `Pin at ${formatMetLabel(met)}`;
    save.disabled = true;
    options.status(consoleCopy.pinning);
    const result = await request<MissionEvent>("POST", `${options.apiBase}/events`, {
      body: {
        met,
        title: titleInput.value,
        ...(noteInput.value.length > 0 ? { note: noteInput.value } : {}),
      },
      headers: { "Idempotency-Key": key },
    });
    save.disabled = false;
    if (result.ok) {
      options.status(consoleCopy.pinned(result.data.met_label));
      options.onSaved(result.data);
      close();
      return;
    }
    if (result.code === "validation") {
      const fields: [string, HTMLElement][] = [
        ["met", metInput],
        ["title", titleInput],
        ["note", noteInput],
      ];
      let focused = false;
      for (const [field, input] of fields) {
        const message = result.errors[field];
        if (message) {
          fieldError(input, message);
          if (!focused) {
            input.focus();
            focused = true;
          }
        }
      }
    }
  };
}

type DeleteOptions = {
  filename: string;
  passId: string;
  status: (message: string) => void;
  onDeleted: () => void;
  onKept: () => void;
};

export function openDeletePassDialog(options: DeleteOptions): void {
  const confirm = el("button", { type: "button", class: "primary", text: "Delete pass" });
  const keep = el("button", { type: "button", text: "Keep pass" });
  const dialog = el(
    "div",
    {
      role: "alertdialog",
      "aria-modal": "true",
      "aria-label": "Delete pass",
      class: "dialog",
    },
    [
      el("p", {
        text: `Delete ${options.filename}? Its samples, transcript lines, pinned events and stored capture are removed for good.`,
      }),
      el("div", { class: "dialog-actions" }, [confirm, keep]),
    ],
  );
  const backdrop = el("div", { class: "backdrop" }, [dialog]);
  document.body.append(backdrop);
  keep.focus();

  const close = (): void => backdrop.remove();

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      options.onKept();
      return;
    }
    trapFocus(dialog, event);
  });
  keep.addEventListener("click", () => {
    close();
    options.onKept();
  });
  confirm.addEventListener("click", () => {
    void (async () => {
      confirm.disabled = true;
      keep.disabled = true;
      options.status(consoleCopy.deleting(options.filename));
      const result = await request<void>("DELETE", `/api/passes/${options.passId}`);
      close();
      if (result.ok) {
        options.status(consoleCopy.deleted(options.filename));
        options.onDeleted();
        return;
      }
      if (result.code === "pass_not_settled") {
        options.status(consoleCopy.deleteNotSettled(options.filename));
      } else if (result.code === "storage_unavailable") {
        options.status(consoleCopy.deleteStorageOffline(options.filename));
      } else if (result.code === "search_unavailable") {
        options.status(consoleCopy.deleteSearchOffline(options.filename));
      } else {
        options.status(consoleCopy.deleteNotSettled(options.filename));
      }
      options.onKept();
    })();
  });
}
