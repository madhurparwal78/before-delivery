import { config, searchIndexName } from "../config.js";

export type EntryDoc = { id: string; deskId: string; kind: string; refId: string; label: string; href: string };

class Meili {
  private readonly url = config.meili.url;
  private readonly key = config.meili.key;

  private async call<T>(path: string, method: string, body?: unknown, timeoutMs = 5000): Promise<T | null> {
    if (!this.url) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.url}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async healthy(): Promise<boolean> {
    const h = await this.call<{ status: string }>("/health", "GET", undefined, 2000);
    return h?.status === "available";
  }

  private async taskOk(taskUid: number | undefined): Promise<boolean> {
    if (taskUid === undefined) return false;
    for (let i = 0; i < 60; i++) {
      const task = await this.call<{ status: string; error?: unknown }>(`/tasks/${taskUid}`, "GET");
      if (task && (task.status === "succeeded" || task.status === "failed")) return task.status === "succeeded" && !task.error;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async ensureIndex(): Promise<boolean> {
    const index = await this.call<unknown>(`/indexes/${searchIndexName()}`, "GET");
    if (index) return true;
    const created = await this.call<{ taskUid: number }>(`/indexes`, "POST", { uid: searchIndexName(), primaryKey: "id" });
    if (!created || !(await this.taskOk(created.taskUid))) return false;
    const s1 = await this.call<{ taskUid: number }>(`/indexes/${searchIndexName()}/settings/searchable-attributes`, "PUT", ["label"]);
    const s2 = await this.call<{ taskUid: number }>(`/indexes/${searchIndexName()}/settings/filterable-attributes`, "PUT", ["deskId"]);
    return (await this.taskOk(s1?.taskUid)) && (await this.taskOk(s2?.taskUid));
  }

  async add(docs: EntryDoc[]): Promise<boolean> {
    if (!docs.length) return true;
    const res = await this.call<{ taskUid: number }>(`/indexes/${searchIndexName()}/documents`, "POST", docs);
    return await this.taskOk(res?.taskUid);
  }
  async delete(ids: string[]): Promise<boolean> {
    if (!ids.length) return true;
    const res = await this.call<{ taskUid: number }>(`/indexes/${searchIndexName()}/documents/delete-batch`, "POST", ids);
    return await this.taskOk(res?.taskUid);
  }
  async deleteByDesk(deskId: string): Promise<boolean> {
    const res = await this.call<{ taskUid: number }>(`/indexes/${searchIndexName()}/documents/filter`, "DELETE", { filter: `deskId = "${deskId}"` });
    return await this.taskOk(res?.taskUid);
  }
  async deleteDeskEntries(deskId: string, kinds: string[], refIds: string[]): Promise<boolean> {
    const ids = kinds.flatMap((kind) => refIds.map((refId) => `${deskId}-${kind}-${refId}`));
    return await this.delete(ids);
  }
  async search(text: string, deskId: string): Promise<EntryDoc[]> {
    const res = await this.call<{ hits: EntryDoc[] }>(`/indexes/${searchIndexName()}/search`, "POST", { q: text, filter: `deskId = "${deskId}"`, limit: 20 }, 3000);
    return res?.hits ?? [];
  }
  async replaceAll(docs: EntryDoc[]): Promise<boolean> {
    const res = await this.call<{ taskUid: number }>(`/indexes/${searchIndexName()}/documents?primaryKey=id`, "POST", docs);
    return await this.taskOk(res?.taskUid);
  }
  async wipe(): Promise<boolean> {
    const res = await this.call<{ taskUid: number }>(`/indexes/${searchIndexName()}/documents`, "DELETE");
    return await this.taskOk(res?.taskUid);
  }
}

export const meili = new Meili();
