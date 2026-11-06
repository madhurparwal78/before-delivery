import type { ActivityJson, AttachmentJson, ChangeResult, RequestJson, SnapshotJson, TaskJson } from "./domain.js";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public data: any) { super(code) }
}

async function json(r: Response): Promise<any> {
  const body = await r.text();
  const data = body.length > 0 ? JSON.parse(body) : null;
  if (!r.ok) {
    const err = data?.error ?? {};
    throw new ApiError(r.status, err.code ?? "network", err);
  }
  return data;
}

export const api = {
  async production(): Promise<import("./domain.js").ProductionJson> {
    return json(await fetch("/api/production")) as Promise<import("./domain.js").ProductionJson>;
  },
  async tasks(): Promise<{ tasks: TaskJson[]; snapshot: SnapshotJson }> {
    return json(await fetch("/api/tasks"));
  },
  async tasksFiltered(params: Record<string, string>): Promise<{ tasks: TaskJson[]; snapshot: SnapshotJson }> {
    const qs = new URLSearchParams(params).toString();
    return json(await fetch(`/api/tasks?${qs}`));
  },
  async task(id: string): Promise<{ task: TaskJson; etag: string }> {
    const r = await fetch(`/api/tasks/${id}`);
    const d = await json(r);
    return { task: d.task, etag: r.headers.get("etag")?.replace(/"/g, "") ?? "" };
  },
  async create(body: Record<string, unknown>, actor: string, key?: string): Promise<ChangeResult> {
    return json(await send("POST", "/api/tasks", body, actor, key));
  },
  async patch(id: string, body: Record<string, unknown>, version: number, actor: string): Promise<ChangeResult> {
    return json(await send("PATCH", `/api/tasks/${id}`, body, actor, undefined, version));
  },
  async bulk(ids: { id: string; version: number }[], set: Record<string, unknown>, actor: string, key?: string): Promise<ChangeResult> {
    return json(await send("POST", "/api/tasks/bulk", { tasks: ids, set }, actor, key));
  },
  async undo(actor: string, key?: string): Promise<ChangeResult> {
    return json(await send("POST", "/api/undo", {}, actor, key));
  },
  async addLink(id: string, blocks: string, actor: string): Promise<ChangeResult> {
    return json(await send("POST", `/api/tasks/${id}/relations`, { blocks }, actor));
  },
  async removeLink(id: string, target: string, actor: string): Promise<ChangeResult> {
    const r = await fetch(`/api/tasks/${id}/relations/${target}`, { method: "DELETE", headers: { "X-Crew-Member": actor } });
    return json(r);
  },
  async activity(id: string): Promise<{ activity: ActivityJson[] }> {
    return json(await fetch(`/api/tasks/${id}/activity`));
  },
  async attachments(id: string): Promise<{ attachments: AttachmentJson[] }> {
    return json(await fetch(`/api/tasks/${id}/attachments`));
  },
  async upload(id: string, file: File, kind: string, actor: string, onProgress: (pct: number) => void): Promise<{ attachment: AttachmentJson }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/tasks/${id}/attachments`);
      xhr.setRequestHeader("X-Crew-Member", actor);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) };
      xhr.onerror = () => reject(new ApiError(0, "network", {}));
      xhr.onload = () => {
        const data = xhr.responseText.length > 0 ? JSON.parse(xhr.responseText) : null;
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(xhr.status, data?.error?.code ?? "upload_failed", data?.error ?? {}));
      };
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      xhr.send(form);
    });
  },
  async decide(id: string, body: Record<string, unknown>, actor: string, key?: string): Promise<ChangeResult> {
    return json(await send("POST", `/api/triage/${id}/decision`, body, actor, key));
  },
  async requests(): Promise<{ requests: RequestJson[] }> {
    return json(await fetch("/api/requests"));
  },
  async fileRequest(body: Record<string, unknown>, key?: string): Promise<{ request: RequestJson }> {
    const r = await fetch("/api/requests", {
      method: "POST", headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
      body: JSON.stringify(body),
    });
    return json(r);
  },
};

async function send(
  method: string, path: string, body: Record<string, unknown>, actor: string,
  key?: string, version?: number,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", "X-Crew-Member": actor };
  if (key !== undefined) headers["Idempotency-Key"] = key;
  if (version !== undefined) headers["If-Match"] = String(version);
  return fetch(path, { method, headers, body: JSON.stringify(body) });
}
