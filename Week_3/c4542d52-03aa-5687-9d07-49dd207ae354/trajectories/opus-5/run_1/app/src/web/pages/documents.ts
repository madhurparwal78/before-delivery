import type { DocumentRecord, LiveEvent } from "../../shared/types.js";
import { ApiFailure } from "../api.js";
import { api } from "../api.js";
import { announce, replaceAddress, type Page, type PageContext } from "../app.js";
import { clear, el } from "../dom.js";
import { openDialog } from "../ui/dialog.js";

const KIND_LABELS: Record<string, string> = {
  grant_agreement: "Grant agreement",
  exercise_notice: "Exercise notice",
  tender_nda: "Tender NDA",
};

export function documentsPage(context: PageContext): Page {
  let openId: string | null = context.params["id"] ?? null;

  async function openViewer(document_: DocumentRecord): Promise<void> {
    const body = el("pre", { class: "document-text" }, ["Opening the document."]);
    const close = el("button", { type: "button" }, ["Close"]) as HTMLButtonElement;
    const details = el("div", { class: "document-details" });
    const dialog = el("dialog", { class: "dialog", "aria-label": "Document viewer" }, [
      el("h2", {}, [document_.title]),
      body,
      details,
      el("div", { class: "dialog-actions" }, [close]),
    ]) as HTMLDialogElement;

    openId = document_.id;
    replaceAddress(`/documents/${document_.id}`);
    const handle = openDialog(dialog, `[data-document="${document_.id}"]`, {
      onClose: () => {
        openId = null;
        replaceAddress("/documents");
      },
    });
    close.addEventListener("click", () => handle.close());

    details.append(
      el("p", {}, [`Seal ${(document_.sha256 ?? "").slice(0, 12)}`]),
      el("p", {}, [`Version ${document_.version}`]),
    );
    if (document_.supersedes !== null) details.append(el("p", {}, [`Corrects ${document_.supersedes}`]));
    if (document_.superseded_by !== null) details.append(el("p", {}, [`Superseded by ${document_.superseded_by}`]));

    try {
      const response = await fetch(`/api/documents/${document_.id}/content`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      body.textContent = await response.text();
    } catch {
      body.replaceChildren(
        el("span", { class: "band band-red" }, ["The document vault can't be reached. Try again shortly."]),
      );
      announce("The document vault can't be reached. Try again shortly.");
    }
  }

  async function draw(): Promise<void> {
    const result = await api<{ documents: DocumentRecord[] }>("/api/documents");
    clear(context.main);
    if (result.documents.length === 0) {
      context.main.append(el("section", { class: "band band-ink full" }, [el("p", {}, ["No documents yet."])]));
      return;
    }
    const items = result.documents.map((document_) => {
      const link = el("a", { href: `/documents/${document_.id}`, "data-document": document_.id }, [document_.title]);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void openViewer(document_);
      });
      return el("li", {}, [
        link,
        el("span", { class: "document-kind" }, [KIND_LABELS[document_.kind] ?? document_.kind]),
        el("span", { class: "document-status" }, [document_.status === "sealed" ? "Sealed" : "Pending"]),
        el("span", { class: "document-seal" }, [`Seal ${(document_.sha256 ?? "").slice(0, 12)}`]),
      ]);
    });
    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, ["Everything sealed in the vault for you."]),
        el("div", { class: "column" }, [
          el("h1", { class: "chapter-title" }, ["Documents"]),
          el("ul", { class: "document-list", role: "list", "aria-label": "Documents" }, items),
        ]),
      ]),
    );
    if (openId !== null) {
      const wanted = result.documents.find((document_) => document_.id === openId);
      if (wanted !== undefined) await openViewer(wanted);
      else {
        openId = null;
        throw new ApiFailure(404, { error: { code: "not_found", message: "This record isn't on your register." } });
      }
    }
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "document_changed" || event.type === "order_changed" || event.type === "grant_changed") {
        if (openId === null) void draw();
      }
    },
  };
}
