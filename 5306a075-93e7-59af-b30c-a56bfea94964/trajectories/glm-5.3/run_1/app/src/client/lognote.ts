import { api, ApiFailure } from "./api.js";
import { h } from "./dom.js";
import { openDialog, feedback } from "./ui.js";

/** The "Log note" dialog: a call note with an optional transcript (DP-12). */
export function openLogNoteDialog(opener: HTMLElement | null, onSaved: () => void): void {
  openDialog((close) => {
    const wrap = h("div", { "aria-label": "Log note" });
    wrap.appendChild(h("h2", null, "Log note"));
    const title = h("input", { type: "text", "aria-label": "Title" }) as HTMLInputElement;
    const body = h("textarea", { "aria-label": "Note body" }) as HTMLTextAreaElement;
    body.addEventListener("paste", (event) => {
      // Pasted formatting is kept by the server's allowlist.
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text.length === 0) return;
      event.preventDefault();
      const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
        .join("");
      body.value += escaped;
    });
    const contact = h("select", { "aria-label": "Contact" }) as HTMLSelectElement;
    const source = h("select", { "aria-label": "Source" }) as HTMLSelectElement;
    for (const [value, label] of [
      ["support_ticket", "Support ticket"],
      ["sales_call", "Sales call"],
      ["email", "Email"],
    ] as const) {
      source.appendChild(h("option", { value }, label));
    }
    const file = h("input", { type: "file", "aria-label": "Attach transcript or file" }) as HTMLInputElement;
    const titleError = h("span", { class: "field-error" });
    const bodyError = h("span", { class: "field-error" });
    const fileError = h("span", { class: "field-error" });

    const form = h(
      "form",
      {
        onsubmit: async (event: SubmitEvent) => {
          event.preventDefault();
          titleError.replaceChildren();
          bodyError.replaceChildren();
          fileError.replaceChildren();
          feedback?.saveStatus("Saving note…");
          try {
            const result = await api.createNote({
              title: title.value,
              body: body.value,
              source: source.value,
              contactId: contact.value.length > 0 ? contact.value : null,
            });
            const note = result.note;
            if (file.files !== null && file.files.length > 0) {
              const chosen = file.files[0]!;
              const uploaded = await api.uploadAttachment(note.id, chosen);
              if (uploaded.attachment.status === "pending") {
                feedback?.saveStatus(`${chosen.name} will upload when storage is back.`);
              } else {
                feedback?.saveStatus("Note saved.");
              }
            } else {
              feedback?.saveStatus("Note saved.");
            }
            close();
            onSaved();
          } catch (err) {
            feedback?.saveStatus("");
            if (err instanceof ApiFailure) {
              const fields = err.error.error.fields ?? {};
              if (fields.title !== undefined) titleError.replaceChildren(fields.title);
              if (fields.body !== undefined) bodyError.replaceChildren(fields.body);
              if (fields.file !== undefined) fileError.replaceChildren(fields.file);
              const message = err.error.error.message;
              if (message.includes("larger than")) fileError.replaceChildren(message);
              if (message.includes("not a valid")) fileError.replaceChildren(message);
              if (message.includes("Attach a")) fileError.replaceChildren(message);
              feedback?.alert(message);
            } else {
              feedback?.alert("Something went wrong on our side. Nothing was saved.");
            }
          }
        },
      },
      h("label", null, "Title"),
      title,
      titleError,
      h("label", null, "Note body"),
      body,
      bodyError,
      h("label", null, "Contact"),
      contact,
      h("label", null, "Source"),
      source,
      h("label", null, "Attach transcript or file"),
      file,
      fileError,
      h(
        "div",
        { class: "dialog-actions" },
        h("button", { type: "submit", class: "primary" }, "Save note"),
        h("button", { type: "button", onclick: close }, "Cancel"),
      ),
    );
    wrap.appendChild(form);

    // The workspace's contacts fill the Contact combobox.
    void api.companies().then((result) => {
      const none = h("option", { value: "" }, "No contact");
      contact.appendChild(none);
      for (const company of result.companies) {
        for (const c of company.contacts) {
          contact.appendChild(h("option", { value: c.id }, `${c.name} (${c.email})`));
        }
      }
    });

    return wrap;
  }, opener);
}
