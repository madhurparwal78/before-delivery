import type { Checkpoint, CompareResult, ErrorBody, LimitsConfig, Notebook, Output, PresenceEntry, Role, Share, User } from "../shared/types.ts";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ErrorBody; status: number };

async function request<T>(method: string, path: string, body?: unknown, raw?: boolean): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const text = await response.text();
  if (raw) {
    if (response.ok) return { ok: true, value: text as unknown as T };
    return { ok: false, error: parseError(text), status: response.status };
  }
  if (!response.ok) {
    return { ok: false, error: parseError(text), status: response.status };
  }
  if (text === "") return { ok: true, value: undefined as unknown as T };
  return { ok: true, value: JSON.parse(text) as T };
}

function parseError(text: string): ErrorBody {
  try {
    return JSON.parse(text) as ErrorBody;
  } catch {
    return { error: "unknown", message: text };
  }
}

export const api = {
  health: () => request<{ status: string }>("GET", "/api/health"),
  config: () => request<LimitsConfig>("GET", "/api/config"),
  me: () => request<{ user: User }>("GET", "/api/me"),
  signup: (body: { display_name: string; email: string; password: string; use?: string; invitation_token?: string }) =>
    request<{ user: User; notebook_id?: string }>("POST", "/api/auth/signup", body),
  verify: (token: string) => request<{ user: User }>("POST", "/api/auth/verify", { token }),
  signin: (body: { email: string; password: string }) => request<{ user: User }>("POST", "/api/auth/signin", body),
  signout: () => request<unknown>("POST", "/api/auth/signout"),
  notebooks: () => request<{ notebooks: { id: string; title: string; role: Role; owner_display_name: string; modified_at: string }[] }>("GET", "/api/notebooks"),
  createNotebook: (title: string) => request<{ notebook: Notebook }>("POST", "/api/notebooks", { title }),
  notebook: (id: string) => request<{ notebook: Notebook }>("GET", `/api/notebooks/${id}`),
  deleteNotebook: (id: string) => request<unknown>("DELETE", `/api/notebooks/${id}`),
  save: (id: string, body: { tab_id: string; cells: { id: string; base_revision: number; source: string; cell_type: string }[] }) =>
    request<{ cells: Notebook["cells"] }>("POST", `/api/notebooks/${id}/save`, body),
  insertCell: (id: string, body: { position: number; cell_type: string; source?: string }) =>
    request<{ cells: Notebook["cells"]; new_ids: string[] }>("POST", `/api/notebooks/${id}/cells`, body),
  pasteCells: (id: string, body: { position: number; cells: { cell_type: string; source: string }[] }) =>
    request<{ cells: Notebook["cells"]; new_ids: string[] }>("POST", `/api/notebooks/${id}/cells/paste`, body),
  deleteCells: (id: string, body: { tab_id: string; ids: string[] }) =>
    request<{ cells: Notebook["cells"] }>("POST", `/api/notebooks/${id}/cells/delete`, body),
  restoreCells: (id: string, body: { ids: string[] }) =>
    request<{ cells: Notebook["cells"] }>("POST", `/api/notebooks/${id}/cells/restore`, body),
  moveCell: (id: string, cellId: string, body: { tab_id: string; position: number }) =>
    request<{ cells: Notebook["cells"] }>("POST", `/api/notebooks/${id}/cells/${cellId}/move`, body),
  splitCell: (id: string, cellId: string, body: { tab_id: string; base_revision: number; line: number }) =>
    request<{ cells: Notebook["cells"]; new_ids: string[] }>("POST", `/api/notebooks/${id}/cells/${cellId}/split`, body),
  mergeCells: (id: string, body: { tab_id: string; ids: string[]; base_revisions: Record<string, number> }) =>
    request<{ cells: Notebook["cells"] }>("POST", `/api/notebooks/${id}/cells/merge`, body),
  lockCell: (id: string, cellId: string, tabId: string) =>
    request<{ cell_id: string; holder: string }>("POST", `/api/notebooks/${id}/cells/${cellId}/lock`, { tab_id: tabId }),
  unlockCell: (id: string, cellId: string, tabId: string) =>
    request<unknown>("DELETE", `/api/notebooks/${id}/cells/${cellId}/lock?tab_id=${encodeURIComponent(tabId)}`),
  presence: (id: string, body: { tab_id: string; cell_id: string | null }) =>
    request<{ present: PresenceEntry[] }>("POST", `/api/notebooks/${id}/presence`, body),
  queueRun: (id: string, body: { run_id: string; cell_id: string; tab_id: string }) =>
    request<{ run: { run_id: string; state: string } }>("POST", `/api/notebooks/${id}/runs`, body),
  startRun: (id: string, runId: string) => request<{ run: { run_id: string; state: string } }>("POST", `/api/notebooks/${id}/runs/${runId}/start`),
  runResult: (id: string, runId: string, body: { status: string; outputs: Output[] }) =>
    request<{ run: { execution_count: number | null }; cell: Notebook["cells"][number] }>("POST", `/api/notebooks/${id}/runs/${runId}/result`, body),
  kernel: (id: string, body: { tab_id: string; status: string }) =>
    request<{ kernel_status: string }>("POST", `/api/notebooks/${id}/kernel`, body),
  tableRows: (id: string, cellId: string, index: number, version: number, offset: number, limit: number) =>
    request<{ columns: string[]; rows: unknown[][]; offset: number; total: number; version: number }>(
      "GET",
      `/api/notebooks/${id}/cells/${cellId}/outputs/${index}/rows?version=${version}&offset=${offset}&limit=${limit}`,
    ),
  checkpoints: (id: string) => request<{ checkpoints: Checkpoint[] }>("GET", `/api/notebooks/${id}/checkpoints`),
  createCheckpoint: (id: string, label?: string) =>
    request<{ checkpoint: Checkpoint }>("POST", `/api/notebooks/${id}/checkpoints`, label === undefined ? {} : { label }),
  compare: (id: string, checkpointId: string) => request<CompareResult>("GET", `/api/notebooks/${id}/checkpoints/${checkpointId}/compare`),
  revert: (id: string, checkpointId: string, cellId?: string) =>
    request<{ before_revert: Checkpoint; cells: Notebook["cells"] }>("POST", `/api/notebooks/${id}/checkpoints/${checkpointId}/revert`, cellId === undefined ? {} : { cell_id: cellId }),
  importNotebook: (file: File, title: string) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`/api/notebooks/import?title=${encodeURIComponent(title)}`, {
      method: "POST",
      body: file,
      credentials: "same-origin",
    }).then(async (response) => {
      const text = await response.text();
      if (!response.ok) return { ok: false as const, error: parseError(text), status: response.status };
      return { ok: true as const, value: JSON.parse(text) as { notebook: Notebook } };
    });
  },
  shares: (id: string) => request<{ shares: Share[] }>("GET", `/api/notebooks/${id}/shares`),
  addShare: (id: string, body: { email: string; role: string }) =>
    request<{ share: Share }>("POST", `/api/notebooks/${id}/shares`, body),
  removeShare: (id: string, shareId: string) => request<unknown>("DELETE", `/api/notebooks/${id}/shares/${shareId}`),
  invitation: (token: string) =>
    request<{ email: string; role: Role; notebook_title: string; owner_display_name: string; account_exists: boolean }>("GET", `/api/invitations/${token}`),
  acceptInvitation: (token: string) => request<{ notebook_id: string }>("POST", `/api/invitations/${token}/accept`),
  search: (q: string) => request<{ results: { id: string; title: string }[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`),
};

export function redirectTo(path: string): void {
  window.location.assign(path);
}

export function formatModified(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
