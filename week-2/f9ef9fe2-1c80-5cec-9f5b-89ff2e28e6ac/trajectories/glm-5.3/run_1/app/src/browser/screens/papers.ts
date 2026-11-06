import { api, ApiError } from "../api";
import { el } from "../ui";
import { state, actionPaused } from "../main";
import { openDialog } from "../ui";

interface DocumentRow {
  id: string;
  member_id: string;
  type: string;
  label: string;
  state: string;
  expires_on: string | null;
  original_name: string;
  size_bytes: number;
  content_type: string;
  uploaded_at: string;
  reject_reason: string | null;
}

const STATE_CHIP: Record<string, string> = {
  uploaded: "uploaded",
  verified: "verified",
  rejected: "rejected",
  expiring: "expiring",
  expired: "expired",
};

export function renderPapers(container: HTMLElement): void {
  const wide = el("div", { class: "wide editorial" });
  wide.append(el("h1", { class: "page-title", text: "Papers" }));
  const statusRegion = el("div", { role: "status", "aria-label": "Form status", class: "status-line" });
  const isOperator = state.user!.role === "operator";
  const content = el("div");

  const form = el("form", { class: "stack", "aria-label": "Upload document" });
  const typeSelect = el("select", { id: "doc-type" });
  typeSelect.setAttribute("aria-label", "Document type");
  for (const option of ["insurance", "food_handler", ...(isOperator ? ["kitchen_agreement"] : [])]) {
    typeSelect.append(new Option(labelFor(option), option));
  }
  const typeField = el("div", { class: "field" });
  const typeLabel = el("label", { for: "doc-type" });
  typeLabel.textContent = "Document type";
  typeField.append(typeLabel, typeSelect);

  const expiryField = el("div", { class: "field" });
  const expiryLabel = el("label", { for: "doc-expiry" });
  expiryLabel.textContent = "Expiry date";
  const expiryInput = el("input", { id: "doc-expiry", type: "date" });
  expiryInput.setAttribute("aria-label", "Expiry date");
  expiryField.append(expiryLabel, expiryInput);

  const fileField = el("div", { class: "field" });
  const fileLabel = el("label", { for: "doc-file" });
  fileLabel.textContent = "File";
  const fileInput = el("input", { id: "doc-file", type: "file" });
  fileInput.setAttribute("aria-label", "File");
  fileField.append(fileLabel, fileInput);

  let memberSelect: HTMLSelectElement | null = null;
  let memberField: HTMLElement | null = null;
  if (isOperator) {
    memberSelect = el("select", { id: "doc-member" });
    memberSelect.setAttribute("aria-label", "Member");
    memberField = el("div", { class: "field" });
    const memberLabel = el("label", { for: "doc-member" });
    memberLabel.textContent = "Member";
    memberField.append(memberLabel, memberSelect);
  }

  const uploadBtn = el("button", { class: "btn primary", type: "submit" });
  uploadBtn.textContent = "Upload";
  const uploadFields = el("div", { class: "form-grid" });
  uploadFields.append(typeField, expiryField, fileField);
  if (memberField) {
    uploadFields.append(memberField);
  }
  form.append(uploadFields, uploadBtn);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void upload();
  });

  function applyTypeRules(): void {
    const needsExpiry = typeSelect.value !== "kitchen_agreement";
    expiryInput.disabled = !needsExpiry;
    if (!needsExpiry) {
      expiryInput.value = "";
    }
  }
  typeSelect.addEventListener("change", applyTypeRules);
  applyTypeRules();

  async function upload(): Promise<void> {
    uploadBtn.disabled = true;
    statusRegion.textContent = "Uploading…";
    const file = fileInput.files?.[0];
    if (!file) {
      statusRegion.textContent = "Choose a file to upload.";
      uploadBtn.disabled = false;
      return;
    }
    const data = new FormData();
    data.append("type", typeSelect.value);
    if (typeSelect.value !== "kitchen_agreement" && expiryInput.value) {
      data.append("expires_on", expiryInput.value);
    }
    if (isOperator && memberSelect) {
      data.append("member_id", memberSelect.value);
    }
    data.append("file", file, file.name);
    try {
      const response = await fetch("/api/documents", { method: "POST", body: data, credentials: "same-origin" });
      const text = await response.text();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!response.ok) {
        const code = typeof body.error === "string" ? body.error : "";
        if (code === "unsupported_type") {
          statusRegion.textContent = "Upload a PDF, PNG or JPEG file.";
        } else if (code === "file_too_large") {
          statusRegion.textContent = "Files can be at most 5,000,000 bytes.";
        } else if (code === "files_unavailable") {
          statusRegion.textContent = "File storage is unreachable. Uploading is paused; try again shortly.";
        } else {
          const errors = body.errors as Record<string, string> | undefined;
          const first = errors ? Object.values(errors)[0] : undefined;
          statusRegion.textContent = first ?? (typeof body.message === "string" ? body.message : "Upload failed.");
        }
        uploadBtn.disabled = false;
        return;
      }
      statusRegion.textContent = `Uploaded ${labelFor(typeSelect.value)}. It counts once the kitchen verifies it.`;
      fileInput.value = "";
      expiryInput.value = "";
      await refresh();
    } catch {
      statusRegion.textContent = "Something went wrong.";
    }
    uploadBtn.disabled = false;
  }

  wide.append(statusRegion, form, content);
  container.append(wide);

  async function refresh(): Promise<void> {
    if (isOperator && memberSelect) {
      const members = await api<{ members: Array<{ id: string; business: string }> }>("GET", `/kitchens/${state.user!.kitchen_id}/members`);
      memberSelect.replaceChildren();
      for (const member of members.members) {
        memberSelect.append(new Option(member.business, member.id));
      }
    }
    const body = await api<{ documents: DocumentRow[] }>("GET", "/documents");
    const docs = body.documents;
    content.replaceChildren();
    if (state.user!.role === "member") {
      content.append(section("My documents", "My documents", docs, false));
    } else {
      const toReview = docs.filter((doc) => doc.state === "uploaded");
      const sortedToReview = [...toReview].sort((a, b) => (a.uploaded_at < b.uploaded_at ? -1 : 1));
      content.append(section("Documents to review", "Documents to review", sortedToReview, true));
      content.append(section("All documents", "All documents", docs, true));
    }
  }

  function section(heading: string, tableLabel: string, docs: DocumentRow[], withMember: boolean): HTMLElement {
    const sectionEl = el("section", { class: "first" });
    sectionEl.append(el("h2", { text: heading }));
    if (docs.length === 0) {
      sectionEl.append(el("p", { class: "muted", text: "No documents." }));
      return sectionEl;
    }
    const table = el("table", { class: "data card-table", "aria-label": tableLabel });
    const headRow = el("tr");
    for (const column of ["Type", ...(withMember ? ["Member"] : []), "Expires", "State", "File"]) {
      headRow.append(el("th", { text: column }));
    }
    const thead = el("thead");
    thead.append(headRow);
    table.append(thead);
    const tbody = el("tbody");
    for (const doc of docs) {
      const row = el("tr");
      row.append(el("td", { text: doc.label, "data-label": "Type" }));
      if (withMember) {
        row.append(el("td", { text: doc.member_id, "data-label": "Member" }));
      }
      row.append(el("td", { text: doc.expires_on ?? "\u2014", class: "num", "data-label": "Expires" }));
      const stateCell = el("td", { "data-label": "State" });
      stateCell.append(el("span", { class: `state-chip ${STATE_CHIP[doc.state]}`, text: doc.state }));
      row.append(stateCell);
      const fileCell = el("td", { "data-label": "File" });
      const link = el("a", { href: "#", onclick: (event: Event) => {
        event.preventDefault();
        void openDocument(doc);
      } });
      link.setAttribute("aria-label", `Open ${doc.label}`);
      link.textContent = doc.original_name;
      fileCell.append(link);
      row.append(fileCell);
      if (isOperator && doc.state === "uploaded") {
        const actions = el("td", { class: "actions", "data-label": "Actions" });
        const verify = el("button", { class: "btn", onclick: () => void review(doc, "verify") });
        verify.textContent = "Verify";
        const reject = el("button", { class: "btn", onclick: () => void openReject(doc) });
        reject.textContent = "Reject";
        actions.append(verify, reject);
        row.append(actions);
      }
      tbody.append(row);
    }
    table.append(tbody);
    sectionEl.append(table);
    return sectionEl;
  }

  async function openDocument(doc: DocumentRow): Promise<void> {
    try {
      const response = await fetch(`/api/documents/${doc.id}/file`, { credentials: "same-origin" });
      if (!response.ok) {
        statusRegion.textContent = "File storage is unreachable. Opening documents is paused.";
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.original_name;
      anchor.click();
      URL.revokeObjectURL(url);
      statusRegion.replaceChildren();
    } catch {
      statusRegion.textContent = "File storage is unreachable. Opening documents is paused.";
    }
  }

  async function review(doc: DocumentRow, action: "verify" | "reject"): Promise<void> {
    statusRegion.textContent = "Saving…";
    try {
      await api("POST", `/documents/${doc.id}/${action}`, action === "reject" ? { reason: "Rejected" } : {});
      statusRegion.textContent = action === "verify" ? `Verified ${doc.label} for ${doc.member_id}.` : `Rejected ${doc.label} for ${doc.member_id}.`;
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "invalid_transition") {
        statusRegion.textContent = `This document is already ${String(error.extra.from).replace(/_/g, " ")}.`;
      } else {
        statusRegion.textContent = error instanceof ApiError ? error.message : "Something went wrong.";
      }
    }
  }

  function openReject(doc: DocumentRow): void {
    const body = el("div", { class: "dialog-body" });
    const field = el("div", { class: "field" });
    const label = el("label", { for: "reject-reason" });
    label.textContent = "Reason";
    const input = el("input", { id: "reject-reason", type: "text" });
    input.setAttribute("aria-label", "Reason");
    field.append(label, input);
    body.append(field);
    const actions = el("div", { class: "dialog-actions" });
    const confirm = el("button", { class: "btn primary" });
    confirm.textContent = "Reject document";
    const back = el("button", { class: "btn" });
    back.textContent = "Back";
    actions.append(confirm, back);
    body.append(actions);
    const handle = openDialog({ label: "Reject document", body }, () => undefined);
    back.addEventListener("click", () => handle.close(null));
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        await api("POST", `/documents/${doc.id}/reject`, { reason: input.value });
        statusRegion.textContent = `Rejected ${doc.label} for ${doc.member_id}.`;
        handle.close(true);
        await refresh();
      } catch (error) {
        confirm.disabled = false;
        if (error instanceof ApiError && error.code === "validation") {
          const errors = error.extra.errors as Record<string, string> | undefined;
          statusRegion.textContent = errors?.reason ?? "Give a reason of 1 to 300 characters.";
        } else if (error instanceof ApiError && error.code === "invalid_transition") {
          statusRegion.textContent = `This document is already ${String(error.extra.from).replace(/_/g, " ")}.`;
        } else {
          statusRegion.textContent = error instanceof ApiError ? error.message : "Something went wrong.";
        }
      }
    });
  }

  if (actionPaused("upload_document")) {
    uploadBtn.disabled = true;
    window.addEventListener("pilotlight:status", () => {
      uploadBtn.disabled = actionPaused("upload_document");
    });
  }
  void refresh();
}

function labelFor(type: string): string {
  if (type === "insurance") {
    return "Insurance certificate";
  }
  if (type === "food_handler") {
    return "Food-handler card";
  }
  return "Signed kitchen-use agreement";
}
