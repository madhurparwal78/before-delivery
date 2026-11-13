export interface SessionInfo {
  user: { id: string; email: string; name: string };
  team: { id: string; name: string };
  role: "owner" | "member" | "viewer";
}

export interface RecipientDto {
  id: string;
  name: string;
  email: string;
  order: number;
  status: "waiting" | "invited" | "viewed" | "signed" | "declined" | "expired";
  delivery: null | "sent" | "held";
  linkExpiresAt: string | null;
  signedAt: string | null;
  declineReason: string | null;
  binding: boolean;
}

export interface FieldDto {
  id: string;
  recipientId: string;
  kind: "signature" | "initials" | "date" | "text";
  label: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
}

export interface DocumentDto {
  id: string;
  title: string;
  status: "draft" | "in_progress" | "sealing" | "completed" | "declined" | "voided";
  teamId: string;
  ownerId: string;
  timeZone: string;
  pageCount: number;
  originalSha256: string;
  completedSha256: string | null;
  version: number;
  currentOrder: number | null;
  reminderAvailableAt: string | null;
  recipients: RecipientDto[];
  fields: FieldDto[];
}

export interface DocumentListItem {
  id: string;
  title: string;
  status: DocumentDto["status"];
  nextStep: string;
  updatedAt: string;
}

export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
  recipients?: string[];
  status?: string;
  availableAt?: string;
  limit?: number;
  remaining?: number;
  state?: string;
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  const init: RequestInit = { method, headers: opts.headers ?? {}, credentials: "same-origin" };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { "content-type": "application/json", ...(opts.headers ?? {}) };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as T & Partial<ApiErrorBody>;
    if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody);
    return data;
  }
  if (!res.ok) {
    let parsed: ApiErrorBody = { error: "internal" };
    try { parsed = (await res.json()) as ApiErrorBody; } catch { /* non-json */ }
    throw new ApiError(res.status, parsed);
  }
  if (opts.raw) return (await res.arrayBuffer()) as unknown as T;
  return undefined as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>("POST", path, body, { headers }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
  raw: (path: string) => fetch(path, { credentials: "same-origin" }),
};

export function statusWord(status: DocumentDto["status"]): string {
  switch (status) {
    case "draft": return "Draft";
    case "in_progress": return "In progress";
    case "sealing": return "Sealing";
    case "completed": return "Completed";
    case "declined": return "Declined";
    case "voided": return "Voided";
  }
}

export function recipientRowWord(r: RecipientDto): string {
  if (r.status === "invited" && r.delivery === "held") return "Not delivered yet";
  switch (r.status) {
    case "waiting": return "Waiting";
    case "invited": return "Invited";
    case "viewed": return "Viewed";
    case "signed": return "Signed";
    case "declined": return "Declined";
    case "expired": return "Link expired";
  }
}
