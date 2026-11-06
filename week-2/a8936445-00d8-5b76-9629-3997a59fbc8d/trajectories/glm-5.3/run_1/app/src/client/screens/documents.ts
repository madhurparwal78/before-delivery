/** Documents: upload, list, review. */

import type { Document, DocumentKind, User } from "../../shared/api-types.js";
import { DOCUMENT_KIND_LABELS } from "../../shared/api-types.js";
import { ApiClientError, apiJson, apiOpenFile } from "../api.js";
import type { Feedback } from "../feedback.js";
import { clearActivity, fallbackCopy, showActivity, showError } from "../feedback.js";
import { openDialog } from "../ui/dialog.js";

interface ScreenDeps {
  user: User | null;
  feedback: Feedback;
  navigate(path: string): void;
}

const STATUS_WORDS: Record<string, string> = {
  pending_review: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected"
};

export async function renderDocuments(root: HTMLElement, deps: ScreenDeps): Promise<void> {
  const user = deps.user;
  if (user === null) return;
  const activeUser = user;
  const screen = document.createElement("div");
  screen.className = "screen";
  const title = document.createElement("h1");
  title.textContent = "Documents";
  screen.appendChild(title);

  // The business's status as a mono badge.
  const statusBadge = document.createElement("span");
  statusBadge.className = "badge";
  statusBadge.textContent = "…";
  screen.appendChild(statusBadge);

  const uploadPanel = document.createElement("section");
  uploadPanel.className = "panel";
  const form = document.createElement("form");
  form.setAttribute("aria-label", "Upload document");

  const kindSelect = document.createElement("select");
  const holderRow = document.createElement("div");
  const kindRow = buildField("Document type", "doc-kind", kindSelect);
  for (const [kind, label] of Object.entries(DOCUMENT_KIND_LABELS)) {
    kindSelect.add(new Option(label, kind));
  }
  kindSelect.addEventListener("change", () => {
    holderRow.style.display = kindSelect.value === "food_handler_card" ? "" : "none";
  });

  const expiryInput = document.createElement("input");
  expiryInput.type = "date";
  const expiryRow = buildField("Expiry date", "doc-expiry", expiryInput);

  const holderInput = document.createElement("input");
  holderInput.maxLength = 120;
  holderRow.append(...buildField("Name on card", "doc-holder", holderInput).children as unknown as HTMLElement[]);
  holderRow.style.display = "none";
  // Rebuild the holder field inside its own wrapper for clean layout.
  const holderInner = buildField("Name on card", "doc-holder", holderInput);
  holderRow.replaceChildren(...Array.from(holderInner.children));

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
  const fileRow = buildField("Document file", "doc-file", fileInput);
  const fileHint = document.createElement("span");
  fileHint.className = "hint";
  fileHint.textContent = "PDF, JPEG or PNG, up to 5,000,000 bytes";
  fileRow.appendChild(fileHint);
  const uploadButton = document.createElement("button");
  uploadButton.className = "btn primary";
  uploadButton.type = "submit";
  uploadButton.textContent = "Upload document";
  form.append(kindRow, expiryRow, holderRow, fileRow, uploadButton);
  uploadPanel.appendChild(form);
  screen.appendChild(uploadPanel);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "data";
  table.setAttribute("aria-label", "Documents");
  table.innerHTML = `<thead><tr><th scope="col">Type</th><th scope="col">Name on card</th><th scope="col">Expiry date</th><th scope="col">Status</th><th scope="col">File</th><th scope="col">Actions</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  screen.appendChild(tableWrap);
  root.replaceChildren(screen);


  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void upload();
  });

  async function load(): Promise<void> {
    showActivity(deps.feedback, "Loading…");
    try {
      const [docsRes, tenantRes] = await Promise.all([
        apiJson<{ documents: Document[] }>("GET", "/api/documents"),
        apiJson<{ tenants: Array<{ status: string }> }>("GET", "/api/tenants")
      ]);
      clearActivity(deps.feedback);
      const tenant = tenantRes.tenants[0];
      statusBadge.textContent = tenantStatusWord(tenant?.status ?? "");
      renderRows(docsRes.documents);
    } catch (e) {
      clearActivity(deps.feedback);
      if (e instanceof ApiClientError) showError(deps.feedback, fallbackCopy(e));
    }
  }

  function renderRows(documents: Document[]): void {
    tbody.replaceChildren();
    for (const doc of documents) {
      const tr = document.createElement("tr");
      if (!doc.valid && doc.status === "approved") tr.classList.add("row-highlight");
      const cells: Array<[string, string]> = [
        ["Type", DOCUMENT_KIND_LABELS[doc.kind]],
        ["Name on card", doc.holder_name ?? ""],
        ["Expiry date", doc.expires_on],
        ["Status", doc.valid ? `${STATUS_WORDS[doc.status] ?? doc.status}` : doc.status === "approved" ? "Expired" : STATUS_WORDS[doc.status] ?? doc.status]
      ];
      for (const [label, value] of cells) {
        const td = document.createElement("td");
        td.dataset.label = label;
        td.textContent = value;
        if (label === "Expiry date") td.className = "mono";
        tr.appendChild(td);
      }
      const fileTd = document.createElement("td");
      fileTd.dataset.label = "File";
      const link = document.createElement("a");
      link.textContent = `Open ${DOCUMENT_KIND_LABELS[doc.kind]}`;
      link.href = "#";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void openFile(doc);
      });
      fileTd.appendChild(link);
      tr.appendChild(fileTd);

      const actionTd = document.createElement("td");
      actionTd.dataset.label = "Actions";
      if (activeUser.role === "operator" && doc.status === "pending_review") {
        const approve = document.createElement("button");
        approve.className = "btn";
        approve.textContent = `Approve ${DOCUMENT_KIND_LABELS[doc.kind]} for ${tenantNameFor(doc.tenant_id)}, expires ${doc.expires_on}`;
        approve.addEventListener("click", () => void approveDoc(doc));
        const reject = document.createElement("button");
        reject.className = "btn";
        reject.textContent = `Reject ${DOCUMENT_KIND_LABELS[doc.kind]} for ${tenantNameFor(doc.tenant_id)}, expires ${doc.expires_on}`;
        reject.addEventListener("click", () => openRejectDialog(doc));
        actionTd.append(approve, reject);
      } else {
        actionTd.textContent = "";
      }
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    }
  }

  let tenantNames = new Map<string, string>();
  if (activeUser.role === "operator") {
    const tenants = await apiJson<{ tenants: Array<{ id: string; business_name: string }> }>("GET", "/api/tenants");
    tenantNames = new Map(tenants.tenants.map((t) => [t.id, t.business_name]));
  } else if (activeUser.tenant_id !== null) {
    const tenant = await apiJson<{ business_name: string }>("GET", `/api/tenants/${activeUser.tenant_id}`);
    tenantNames.set(activeUser.tenant_id, tenant.business_name);
  }
  const tenantNameFor = (id: string): string => tenantNames.get(id) ?? id;

  async function upload(): Promise<void> {
    const file = fileInput.files?.[0];
    if (file === undefined) {
      showError(deps.feedback, "Choose the document file.");
      return;
    }
    const kind = kindSelect.value as DocumentKind;
    const formData = new FormData();
    formData.append("kind", kind);
    formData.append("expires_on", expiryInput.value);
    if (kind === "food_handler_card") {
      formData.append("holder_name", holderInput.value);
    }
    if (activeUser.role === "operator") {
      // Operators pick the tenant in a combobox on the form.
      const tenantId = (form.querySelector("#doc-tenant") as HTMLSelectElement)?.value;
      if (tenantId === undefined || tenantId === "") {
        showError(deps.feedback, "Choose the tenant.");
        return;
      }
      formData.append("tenant_id", tenantId);
    }
    formData.append("file", file);
    uploadButton.disabled = true;
    showActivity(deps.feedback, `Uploading ${file.name}…`);
    try {
      await apiJson<Document>("POST", "/api/documents", formData);
      form.reset();
      await load();
      clearActivity(deps.feedback);
      showActivity(deps.feedback, `${DOCUMENT_KIND_LABELS[kind]} uploaded. The kitchen will review it.`);
    } catch (e) {
      if (e instanceof ApiClientError) {
        showError(
          deps.feedback,
          e.detail.code === "file_too_large"
            ? "That file is larger than the upload limit."
            : e.detail.code === "unsupported_file_type"
              ? "Only PDF, JPEG or PNG files are accepted. This file is not one of them."
              : e.detail.code === "storage_unavailable"
                ? "Document storage is unreachable. Nothing was uploaded; try again in a moment."
                : e.detail.code === "validation_failed"
                  ? "Check the highlighted fields."
                  : fallbackCopy(e)
        );
      }
    } finally {
      uploadButton.disabled = false;
    }
  }

  async function openFile(doc: Document): Promise<void> {
    showActivity(deps.feedback, "Opening file…");
    try {
      await apiOpenFile(`/api/documents/${doc.id}/file`);
      clearActivity(deps.feedback);
    } catch (e) {
      clearActivity(deps.feedback);
      if (e instanceof ApiClientError) {
        showError(
          deps.feedback,
          e.detail.code === "storage_unavailable"
            ? "Document storage is unreachable. Try again in a moment."
            : fallbackCopy(e)
        );
      }
    }
  }

  async function approveDoc(doc: Document): Promise<void> {
    showActivity(deps.feedback, "Approving…");
    try {
      await apiJson<Document>("POST", `/api/documents/${doc.id}/approve`, {});
      await load();
      clearActivity(deps.feedback);
      showActivity(
        deps.feedback,
        `${DOCUMENT_KIND_LABELS[doc.kind]} for ${tenantNameFor(doc.tenant_id)} approved. The owner's email is queued.`
      );
    } catch (e) {
      if (e instanceof ApiClientError) {
        showError(
          deps.feedback,
          e.detail.code === "storage_unavailable"
            ? "Document storage is unreachable, so the file can't be checked. Nothing was approved."
            : e.detail.code === "file_missing"
              ? "The stored file can't be read. Ask the tenant to upload it again."
              : fallbackCopy(e)
        );
      }
    }
  }

  function openRejectDialog(doc: Document): void {
    openDialog({
      label: "Reject document",
      build: (inner, close) => {
        const field = document.createElement("div");
        field.className = "field";
        const label = document.createElement("label");
        label.setAttribute("for", "reject-reason");
        label.textContent = "Reason";
        const reason = document.createElement("input");
        reason.id = "reject-reason";
        reason.maxLength = 500;
        field.append(label, reason);
        const fieldError = document.createElement("span");
        fieldError.className = "field-error";
        field.appendChild(fieldError);
        const actions = document.createElement("div");
        actions.className = "dialog-actions";
        const send = document.createElement("button");
        send.className = "btn primary";
        send.textContent = "Send rejection";
        send.addEventListener("click", async () => {
          if (reason.value.trim().length < 1) {
            fieldError.textContent = "Give a reason for the tenant.";
            return;
          }
          showActivity(deps.feedback, "Sending rejection…");
          try {
            await apiJson<Document>("POST", `/api/documents/${doc.id}/reject`, { reason: reason.value });
            close();
            await load();
            clearActivity(deps.feedback);
            showActivity(
              deps.feedback,
              `${DOCUMENT_KIND_LABELS[doc.kind]} for ${tenantNameFor(doc.tenant_id)} rejected. The owner's email is queued.`
            );
          } catch (e) {
            if (e instanceof ApiClientError) {
              if (e.detail.code === "validation_failed") {
                fieldError.textContent = "Give a reason for the tenant.";
                return;
              }
              showError(deps.feedback, fallbackCopy(e));
            }
          }
        });
        const cancel = document.createElement("button");
        cancel.className = "btn";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => close());
        actions.append(send, cancel);
        inner.append(field, actions);
      }
    });
  }

  // Operators get a tenant picker on the upload form.
  if (activeUser.role === "operator") {
    const tenantSelect = document.createElement("select");
    tenantSelect.required = true;
    tenantSelect.add(new Option("Choose a tenant", ""));
    const tenantRow = buildField("Tenant", "doc-tenant", tenantSelect);
    form.insertBefore(tenantRow, kindRow);
    const tenants = await apiJson<{ tenants: Array<{ id: string; business_name: string }> }>("GET", "/api/tenants");
    for (const t of tenants.tenants) tenantSelect.add(new Option(t.business_name, t.id));
  }

  await load();
}

function tenantStatusWord(status: string): string {
  switch (status) {
    case "applied":
      return "Applied";
    case "documents_review":
      return "Documents review";
    case "active":
      return "Active";
    case "suspended":
      return "Suspended";
    case "offboarded":
      return "Offboarded";
    default:
      return status;
  }
}

function buildField(
  labelText: string,
  id: string,
  input: HTMLInputElement | HTMLSelectElement
): HTMLElement {
  const row = document.createElement("div");
  row.className = "field";
  const label = document.createElement("label");
  label.setAttribute("for", id);
  label.textContent = labelText;
  input.id = id;
  input.name = id;
  row.append(label, input);
  return row;
}
