import {
  COPY,
  inviteSent,
  uploadDone,
  uploadProgress,
  uploadSizeRefused,
  uploadTypeRefused,
} from "../shared/copy.js";
import { announce, api, downloadBlob, pageData, qs, qsa, trapDialog, type ErrorBody } from "./dom.js";

interface FileBody {
  id: string;
  kind: "asset" | "deliverable";
  name: string;
  type: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

interface ProjectBody {
  id: string;
  assets: FileBody[];
  deliverables: FileBody[];
}

const PROGRESS_STEPS = [0, 25, 50, 75, 100];

function renderList(list: HTMLElement | null, files: FileBody[]): void {
  if (!list) return;
  list.innerHTML = files
    .map(
      (file) => `<li>
      <span class="file-name">${file.name}</span>
      <span class="file-meta">${file.uploadedBy} — ${file.size} bytes</span>
      <button type="button" data-download-file="${file.id}">Download ${file.name}</button>
    </li>`,
    )
    .join("");
}

async function refreshProject(projectId: string): Promise<void> {
  const result = await api<ProjectBody>(`/api/projects/${projectId}`);
  if (result.status !== 200) return;
  renderList(qs<HTMLElement>("[data-asset-list]"), result.body.assets);
  renderList(qs<HTMLElement>("[data-deliverable-list]"), result.body.deliverables);
}

function uploadWithProgress(
  url: string,
  file: File,
  status: HTMLElement | null,
): Promise<{ status: number; body: (FileBody & ErrorBody) | null }> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append("file", file);
    const request = new XMLHttpRequest();
    let announced = -1;
    request.open("POST", url);
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      for (const step of PROGRESS_STEPS) {
        if (percent >= step && announced < step) {
          announced = step;
          announce(status, uploadProgress(file.name, step));
        }
      }
    });
    request.addEventListener("load", () => {
      let body: (FileBody & ErrorBody) | null = null;
      try {
        body = JSON.parse(request.responseText) as FileBody & ErrorBody;
      } catch {
        body = null;
      }
      resolve({ status: request.status, body });
    });
    request.addEventListener("error", () => resolve({ status: 0, body: null }));
    announce(status, uploadProgress(file.name, 0));
    announced = 0;
    request.send(form);
  });
}

async function startDownload(path: string, status: HTMLElement | null, fallbackName: string): Promise<void> {
  const link = await api<{ url: string } & ErrorBody>(path, { method: "POST", body: {} });
  if (link.status !== 201) {
    announce(status, link.status === 503 ? COPY.storageOutageUpload : link.body.message);
    return;
  }
  const response = await fetch(link.body.url);
  if (response.status === 410) {
    announce(status, COPY.linkExpired);
    return;
  }
  if (response.status === 503) {
    announce(status, COPY.storageOutageUpload);
    return;
  }
  if (!response.ok) {
    announce(status, COPY.notFoundHeading);
    return;
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const named = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  downloadBlob(await response.blob(), named);
}

export function initFiles(): void {
  const data = pageData<{ page: string; projectId?: string }>();
  const status = qs<HTMLElement>("[data-upload-status]");

  for (const input of qsa<HTMLInputElement>("[data-upload]")) {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      const projectId = data?.projectId;
      if (!file || !projectId) return;
      const kind = input.dataset.upload === "deliverable" ? "deliverables" : "assets";
      const result = await uploadWithProgress(`/api/projects/${projectId}/${kind}`, file, status);
      input.value = "";
      if (result.status === 201) {
        announce(status, uploadDone(file.name));
        await refreshProject(projectId);
        return;
      }
      if (result.status === 415) {
        announce(status, uploadTypeRefused(file.name));
        return;
      }
      if (result.status === 413) {
        announce(status, uploadSizeRefused(file.name));
        return;
      }
      if (result.status === 422) {
        announce(status, result.body?.fields?.file ?? COPY.uploadNameRefused);
        return;
      }
      if (result.status === 503 || result.status === 0) {
        announce(status, COPY.storageOutageUpload);
        return;
      }
      announce(status, result.body?.message ?? COPY.storageOutageUpload);
    });
  }

  document.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const fileButton = target.closest<HTMLElement>("[data-download-file]");
    if (fileButton) {
      await startDownload(`/api/files/${fileButton.dataset.downloadFile}/links`, status, "download");
      return;
    }
    const invoiceButton = target.closest<HTMLElement>("[data-download-invoice]");
    if (invoiceButton) {
      await startDownload(`/api/invoices/${invoiceButton.dataset.downloadInvoice}/links`, status, "invoice.pdf");
    }
  });

  const inviteDialogRoot = qs<HTMLElement>("[data-invite-dialog]");
  if (inviteDialogRoot && data?.projectId) {
    const dialog = trapDialog(inviteDialogRoot);
    const inviteStatus = qs<HTMLElement>("[data-invite-status]");
    qs<HTMLElement>("[data-invite-open]")?.addEventListener("click", () => dialog.open());
    qs<HTMLElement>("[data-invite-close]")?.addEventListener("click", () => dialog.close());
    const form = qs<HTMLFormElement>("[data-invite-send]", inviteDialogRoot);
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const field = qs<HTMLElement>("[data-invite-field]", inviteDialogRoot);
      if (field) field.hidden = true;
      const email = qs<HTMLInputElement>('[name="email"]', form)?.value ?? "";
      announce(inviteStatus, COPY.invitePending);
      const result = await api<{ invite: { email: string } } & ErrorBody>(
        `/api/projects/${data.projectId}/invites`,
        { method: "POST", body: { email } },
      );
      if (result.status === 201) {
        announce(inviteStatus, inviteSent(result.body.invite.email));
        form.reset();
        return;
      }
      if (result.status === 422 && field) {
        field.hidden = false;
        field.textContent = result.body.fields?.email ?? result.body.message;
        announce(inviteStatus, result.body.fields?.email ?? result.body.message);
        return;
      }
      announce(inviteStatus, result.body.message);
    });
  }
}
