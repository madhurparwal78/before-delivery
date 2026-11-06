/** PocketBase request intake client (DP-01, DP-02, DP-33, DP-34). */
export interface IntakeRequest {
  id: string; title: string; details: string; requester: string; department: string;
  status: string; task: string; decision_note: string; decided_at: string | null; created: string;
}

export class IntakeRefused extends Error {}

export class Intake {
  private token: string | null = null;
  private tokenAt = 0;
  up = false;

  constructor(
    private baseUrl: string,
    private adminEmail: string,
    private adminPassword: string,
  ) {}

  private async auth(): Promise<string> {
    if (this.token && Date.now() - this.tokenAt < 60 * 60_000) return this.token;
    const r = await fetch(`${this.baseUrl}/api/admins/auth-with-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: this.adminEmail, password: this.adminPassword }),
    });
    if (!r.ok) throw new Error("intake auth failed");
    this.token = (await r.json()).token as string;
    this.tokenAt = Date.now();
    return this.token;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await this.auth();
    const r = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 401) { this.token = null; throw new IntakeRefused("auth") }
    return r;
  }

  async check(): Promise<boolean> {
    try {
      await this.ensureCollection();
      this.up = true;
    } catch {
      this.up = false;
    }
    return this.up;
  }

  async ensureCollection(): Promise<void> {
    const token = await this.auth();
    const r = await fetch(`${this.baseUrl}/api/collections/requests`, { headers: { authorization: token } });
    if (r.status === 200) return;
    const create = await fetch(`${this.baseUrl}/api/collections`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify({
        name: "requests",
        type: "base",
        schema: [
          { name: "title", type: "text", required: true },
          { name: "details", type: "text" },
          { name: "requester", type: "text", required: true },
          { name: "department", type: "text" },
          { name: "status", type: "select", required: true, options: { values: ["pending", "accepted", "declined", "merged"], maxSelect: 1 } },
          { name: "task", type: "text" },
          { name: "decision_note", type: "text" },
          { name: "decided_at", type: "date" },
        ],
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      }),
    });
    if (!create.ok) throw new Error(`intake collection create failed: ${await create.text()}`);
    await this.seedRequests(token);
  }

  private async seedRequests(token: string): Promise<void> {
    const seeded = [
      { title: "The upstage door still sticks when it swings shut", details: "Caught it twice on the Act 1 entrance.", requester: "Leon Park", department: "carpentry" },
      { title: "Bring the thunder in after the line about barring the door", details: "It currently lands before the line.", requester: "Leon Park", department: "sound" },
      { title: "Lose the rocking chair in Act 2, it slows the scene change", details: "", requester: "Hana Ito", department: "props" },
    ];
    for (const s of seeded) {
      const r = await fetch(`${this.baseUrl}/api/collections/requests/records`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: token },
        body: JSON.stringify({ ...s, status: "pending" }),
      });
      if (!r.ok) throw new Error(`intake seed failed: ${await r.text()}`);
    }
  }

  async pending(): Promise<IntakeRequest[]> {
    const r = await this.call("GET", `/api/collections/requests/records?filter=${encodeURIComponent('status = "pending"')}&sort=created&page=1&perPage=200`);
    if (!r.ok) throw new Error("intake read failed");
    const j = await r.json() as { items: Record<string, unknown>[] };
    return j.items.map(mapRecord);
  }

  async list(): Promise<IntakeRequest[]> {
    const r = await this.call("GET", "/api/collections/requests/records?sort=-created&page=1&perPage=200");
    if (!r.ok) throw new Error("intake read failed");
    const j = await r.json() as { items: Record<string, unknown>[] };
    return j.items.map(mapRecord);
  }

  async record(id: string): Promise<IntakeRequest | null> {
    const r = await this.call("GET", `/api/collections/requests/records/${id}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("intake read failed");
    return mapRecord(await r.json() as Record<string, unknown>);
  }

  async create(title: string, requester: string, details: string, department: string): Promise<IntakeRequest> {
    const r = await this.call("POST", "/api/collections/requests/records", {
      title, requester, details, department, status: "pending",
    });
    if (!r.ok) throw new IntakeRefused("create refused");
    return mapRecord(await r.json() as Record<string, unknown>);
  }

  async decide(id: string, patch: { status: string; task: string; decision_note: string; decided_at: string }): Promise<void> {
    const r = await this.call("PATCH", `/api/collections/requests/records/${id}`, patch);
    if (!r.ok) throw new IntakeRefused("decide refused");
  }
}

function mapRecord(r: Record<string, unknown>): IntakeRequest {
  return {
    id: r.id as string,
    title: (r.title as string) ?? "",
    details: (r.details as string) ?? "",
    requester: (r.requester as string) ?? "",
    department: (r.department as string) ?? "",
    status: (r.status as string) ?? "pending",
    task: (r.task as string) ?? "",
    decision_note: (r.decision_note as string) ?? "",
    decided_at: (r.decided_at as string) ?? null,
    created: (r.created as string) ?? "",
  };
}
