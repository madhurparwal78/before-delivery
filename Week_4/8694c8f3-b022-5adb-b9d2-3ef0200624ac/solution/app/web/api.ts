import type {
  Account, ActivityEntry, ApiErrorBody, AssetDoc, CommitResult, MemberDoc, OpDocument, OpInput, PresenceMember, Role, ServiceStatus,
  SetDocument, SetListing, ShowInfo, ShowListing, ShowVersionDoc,
} from "../shared/types.ts";

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: ApiErrorBody["error"];
  readonly network: boolean;

  constructor(status: number, detail: ApiErrorBody["error"], network = false) {
    super(detail.message);
    this.status = status;
    this.code = detail.code;
    this.detail = detail;
    this.network = network;
  }
}

async function request(method: string, path: string, body?: unknown, form?: FormData): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch {
    throw new ApiFailure(0, { code: "network", message: "The network request failed" }, true);
  }
  if (response.ok) return response;
  let detail: ApiErrorBody["error"] = { code: "error", message: response.statusText };
  try {
    detail = ((await response.json()) as ApiErrorBody).error;
  } catch {
    detail = { code: "error", message: response.statusText };
  }
  throw new ApiFailure(response.status, detail);
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await request(method, path, body)).json()) as T;
}

export const api = {
  me: () => json<{ user: Account }>("GET", "/api/me"),
  signup: (body: { email: string; password: string; display_name: string }) => json<{ user: Account }>("POST", "/api/auth/signup", body),
  login: (body: { email: string; password: string }) => json<{ user: Account }>("POST", "/api/auth/login", body),
  logout: async () => {
    await request("POST", "/api/auth/logout");
  },
  status: () => json<ServiceStatus>("GET", "/api/status"),
  sets: () => json<{ sets: SetListing[] }>("GET", "/api/sets"),
  createSet: (name: string) => json<SetDocument>("POST", "/api/sets", { name, starter: "blank-stage" }),
  importSet: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request("POST", "/api/sets/import", undefined, form).then((response) => response.json() as Promise<SetDocument>);
  },
  set: (id: string) => json<SetDocument>("GET", `/api/sets/${id}`),
  sendOp: (setId: string, clientOpId: string, baseVersion: number | undefined, op: OpInput) =>
    json<CommitResult>("POST", `/api/sets/${setId}/ops`, {
      client_op_id: clientOpId, target: op.target, base_version: baseVersion, type: op.type, payload: op.payload,
    }),
  opsAfter: (setId: string, after: number) => json<{ ops: OpDocument[]; head: number }>("GET", `/api/sets/${setId}/ops?after=${after}`),
  assets: (setId: string) => json<{ assets: AssetDoc[] }>("GET", `/api/sets/${setId}/assets`),
  uploadAsset: (setId: string, kind: "model" | "texture", file: File) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file, file.name);
    return request("POST", `/api/sets/${setId}/assets`, undefined, form).then((response) => response.json() as Promise<{ asset: AssetDoc }>);
  },
  deleteAsset: async (setId: string, assetId: string) => {
    await request("DELETE", `/api/sets/${setId}/assets/${assetId}`);
  },
  shaderVersions: (setId: string, layerId: string) =>
    json<{ versions: { number: number; sha256: string; size: number; author: { user_id: string; display_name: string }; created_at: string; restored_from: number | null }[] }>(
      "GET", `/api/sets/${setId}/layers/${layerId}/shader/versions`),
  shaderSource: (setId: string, layerId: string, number: number) =>
    json<{ number: number; source: string; sha256: string }>("GET", `/api/sets/${setId}/layers/${layerId}/shader/versions/${number}`),
  shows: (setId: string) => json<ShowListing>("GET", `/api/sets/${setId}/shows`),
  publish: (setId: string) => json<{ show_version: ShowVersionDoc }>("POST", `/api/sets/${setId}/shows`, {}),
  rollback: (setId: string) => json<{ live_number: number; previous_live_number: number | null }>("POST", `/api/sets/${setId}/shows/rollback`),
  activate: (setId: string, number: number) =>
    json<{ live_number: number; previous_live_number: number | null }>("POST", `/api/sets/${setId}/shows/${number}/activate`),
  exportSet: (setId: string) => json<{ export: { id: string; sha256: string; size: number; download_url: string } }>("POST", `/api/sets/${setId}/exports`),
  members: (setId: string) => json<{ members: MemberDoc[] }>("GET", `/api/sets/${setId}/members`),
  invite: (setId: string, role: Exclude<Role, "owner">) => json<{ token: string; url: string; role: Role }>("POST", `/api/sets/${setId}/invites`, { role }),
  invitation: (token: string) => json<{ set_name: string; role: Role; owner_display_name: string; used: boolean }>("GET", `/api/invites/${token}`),
  accept: (token: string) => json<{ set_id: string; role: Role }>("POST", `/api/invites/${token}/accept`),
  activity: (setId: string, before?: string) =>
    json<{ entries: ActivityEntry[] }>("GET", `/api/sets/${setId}/activity${before ? `?before=${before}` : ""}`),
  locks: (setId: string) =>
    json<{ server_time: string; locks: { layer_id: string; holder: { user_id: string; display_name: string }; expires_at: string }[] }>("GET", `/api/sets/${setId}/locks`),
  takeLock: (setId: string, layerId: string) => json<{ holder: { user_id: string; display_name: string }; expires_at: string }>("POST", `/api/sets/${setId}/layers/${layerId}/lock`),
  heartbeat: (setId: string, layerId: string) => json<{ expires_at: string }>("POST", `/api/sets/${setId}/layers/${layerId}/lock/heartbeat`),
  releaseLock: async (setId: string, layerId: string) => {
    await request("DELETE", `/api/sets/${setId}/layers/${layerId}/lock`);
  },
  postPresence: (setId: string, selection: string | null) => json<{ members: PresenceMember[] }>("POST", `/api/sets/${setId}/presence`, { selection }),
  presence: (setId: string) => json<{ members: PresenceMember[] }>("GET", `/api/sets/${setId}/presence`),
  showInfo: (token: string) => json<ShowInfo>("GET", `/api/show/${token}`),
  showBundle: async (token: string) => (await request("GET", `/api/show/${token}/bundle`)).text(),
};
