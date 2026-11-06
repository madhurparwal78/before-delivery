import type {
  Billing,
  Channel,
  Cycle,
  Doc,
  DocSummary,
  Invite,
  Issue,
  Knock,
  Message,
  Person,
  Room,
  ServiceStatus,
  UnreadBody,
  Workspace,
} from "./types.ts";

export interface ApiErrorShape {
  code: string;
  message: string;
  fields?: Record<string, string>;
  current?: unknown;
}

export class ApiError extends Error {
  code: string;
  fields: Record<string, string> | null;
  current: unknown;
  status: number;

  constructor(status: number, shape: ApiErrorShape) {
    super(shape.message);
    this.code = shape.code;
    this.fields = shape.fields ?? null;
    this.current = shape.current ?? null;
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, { code: "network_error", message: "The request didn't reach the server." });
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const body = json as { error?: ApiErrorShape; current?: unknown } | null;
    const shape = (body?.error ?? {
      code: "unknown",
      message: "Something went wrong.",
    }) as ApiErrorShape;
    throw new ApiError(res.status, { ...shape, current: body?.current });
  }
  return { data: json as T, headers: res.headers };
}

export const api = {
  get: <T>(path: string): Promise<{ data: T; headers: Headers }> => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ data: T; headers: Headers }> =>
    request<T>("POST", path, body ?? {}, extraHeaders),
  put: <T>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ data: T; headers: Headers }> =>
    request<T>("PUT", path, body ?? {}, extraHeaders),
  patch: <T>(path: string, body?: unknown): Promise<{ data: T; headers: Headers }> => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string): Promise<{ data: T; headers: Headers }> => request<T>("DELETE", path),

  signIn: (email: string, password: string) =>
    request<{ person: Person; workspace: Workspace | null }>("POST", "/api/session", { email, password }),
  createAccount: (name: string, email: string, password: string) =>
    request<{ person: Person }>("POST", "/api/accounts", { name, email, password }),
  signOut: () => request<void>("DELETE", "/api/session"),
  me: () => request<{ person: Person; workspace: Workspace | null }>("GET", "/api/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("POST", "/api/account/password", { current_password: currentPassword, new_password: newPassword }),

  workspace: () => request<Workspace>("GET", "/api/workspace"),
  saveCalendar: (cal: { time_zone: string; working_weekdays: number[]; holidays: { date: string; name: string }[]; cycle_anchor: string }) =>
    request<Workspace>("PUT", "/api/workspace/calendar", cal),

  currentCycle: () => request<Cycle>("GET", "/api/cycles/current"),
  cycle: (n: number) => request<Cycle>("GET", `/api/cycles/${n}`),

  projects: () => request<{ projects: { id: string; key: string; name: string }[] }>("GET", "/api/projects"),
  issues: (query: string) => request<{ issues: Issue[] }>("GET", `/api/issues${query}`),
  createIssue: (body: Record<string, unknown>) =>
    request<Issue & { due_date_snapped: boolean }>("POST", "/api/issues", body),
  issue: (key: string) => request<Issue>("GET", `/api/issues/${key}`),
  patchIssue: (key: string, body: Record<string, unknown>) =>
    request<Issue & { due_date_snapped: boolean }>("PATCH", `/api/issues/${key}`, body),
  transition: (key: string, to: string) => request<Issue>("POST", `/api/issues/${key}/transition`, { to }),

  channels: () => request<{ channels: Channel[] }>("GET", "/api/channels"),
  channelMessages: (id: string) => request<{ messages: Message[]; typing: string[] }>("GET", `/api/channels/${id}/messages`),
  postMessage: (id: string, body: { body: string; thread_root_id?: number | null }, idempotencyKey: string) =>
    request<Message>("POST", `/api/channels/${id}/messages`, body, { "Idempotency-Key": idempotencyKey }),
  thread: (id: number) => request<{ root: Message; replies: Message[] }>("GET", `/api/messages/${id}/thread`),
  deleteMessage: (id: number) => request<void>("DELETE", `/api/messages/${id}`),
  markChannelRead: (id: string, upTo: number) => request<UnreadBody>("POST", `/api/channels/${id}/read`, { up_to: upTo }),
  markThreadRead: (rootId: number, upTo: number) => request<UnreadBody>("POST", `/api/threads/${rootId}/read`, { up_to: upTo }),
  unread: () => request<UnreadBody>("GET", "/api/unread"),
  inbox: () => request<{ items: Message[] }>("GET", "/api/inbox"),
  typing: (id: string) => request<void>("POST", `/api/channels/${id}/typing`, {}),

  docs: () => request<{ docs: DocSummary[] }>("GET", "/api/docs"),
  doc: (id: string) => request<Doc>("GET", `/api/docs/${id}`),
  saveDoc: (id: string, body: { title: string; body: string; base_version: number }) =>
    request<Doc>("PUT", `/api/docs/${id}`, body),
  docVersions: (id: string) =>
    request<{ versions: { version: number; saved_at: string; saved_by: string; title: string; body: string }[] }>(
      "GET",
      `/api/docs/${id}/versions`
    ),
  restoreDoc: (id: string, body: { version: number; base_version: number }) => request<Doc>("POST", `/api/docs/${id}/restore`, body),

  floor: () => request<{ rooms: Room[]; me: { room_id: string | null; status: string } }>("GET", "/api/floor"),
  joinRoom: (id: string) => request<{ rooms: Room[]; me: { room_id: string | null; status: string } }>("POST", `/api/rooms/${id}/join`, {}),
  leaveRoom: () => request<void>("POST", "/api/rooms/leave", {}),
  heartbeat: () => request<void>("POST", "/api/presence/heartbeat", {}),
  knock: (roomId: string) => request<Knock>("POST", `/api/rooms/${roomId}/knocks`, {}),
  myKnock: (roomId: string) => request<Knock>("GET", `/api/rooms/${roomId}/knocks/mine`),
  roomKnocks: (roomId: string) => request<{ knocks: Knock[] }>("GET", `/api/rooms/${roomId}/knocks`),
  answerKnock: (knockId: string, answer: "let_in" | "not_now") =>
    request<Knock>("POST", `/api/knocks/${knockId}/answer`, { answer }),

  members: () => request<{ members: Person[] }>("GET", "/api/members"),
  removeMember: (id: string) => request<void>("DELETE", `/api/members/${id}`),
  invites: () => request<{ invites: Invite[] }>("GET", "/api/invites"),
  sendInvite: (body: { email: string; role: string; project_ids: string[]; channel_ids: string[] }, key: string) =>
    request<Invite>("POST", "/api/invites", body, { "Idempotency-Key": key }),
  revokeInvite: (id: string) => request<Invite>("DELETE", `/api/invites/${id}`),
  myInvites: () => request<{ invites: Invite[] }>("GET", "/api/invites/mine"),
  acceptInvite: (id: string) => request<{ person: Person; workspace: Workspace }>("POST", `/api/invites/${id}/accept`, {}),

  billing: () => request<Billing>("GET", "/api/billing"),
  updateSeats: (seats: number, key: string) => request<Billing>("PUT", "/api/billing/seats", { seats }, { "Idempotency-Key": key }),

  status: () => request<ServiceStatus>("GET", "/api/status"),

  attachFile: (path: string, file: File, onProgress?: (fraction: number) => void): Promise<{ data: Attachment }> =>
    uploadWithProgress<{ data: Attachment }>(path, file, onProgress),
};

import type { Attachment } from "./types.ts";

/** Upload via fetch when possible; report progress from a chunked read. */
async function uploadWithProgress<T>(path: string, file: File, onProgress?: (fraction: number) => void): Promise<T> {
  const total = file.size;
  if (onProgress && total > 0 && typeof ReadableStream === "function") {
    // Read in chunks so progress can be reported, then send the whole file.
    const chunks: BlobPart[] = [];
    let sent = 0;
    const step = Math.max(65536, Math.floor(total / 20));
    while (sent < total) {
      const slice = file.slice(sent, Math.min(total, sent + step));
      chunks.push(slice);
      sent = Math.min(total, sent + step);
      onProgress(Math.min(0.95, sent / total));
    }
    onProgress(0.98);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
    onProgress(1);
    const json = await res.json();
    if (!res.ok) {
      throw new ApiError(res.status, (json as { error?: ApiErrorShape } | null)?.error ?? { code: "unknown", message: "The upload failed." });
    }
    return json as T;
  }
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
  const json = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, (json as { error?: ApiErrorShape } | null)?.error ?? { code: "unknown", message: "The upload failed." });
  }
  return json as T;
}
