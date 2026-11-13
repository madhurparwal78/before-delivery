import type { Config } from '../config.js';

export interface SvixAttempt {
  id: string;
  status: number;
  responseStatusCode: number | null;
  at: string;
}

export class SvixUnavailable extends Error {}

export type SvixFinalState = 'delivered' | 'retrying' | 'failed' | 'no_endpoint' | 'pending';

export class Svix {
  constructor(private cfg: Config) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.cfg.svixApiKey}`,
      'content-type': 'application/json',
    };
  }

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.svixUrl}/api/v1/app`, { headers: this.headers(), signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async request(path: string, method: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      const init: RequestInit = { method, headers: this.headers(), signal: AbortSignal.timeout(10_000) };
      if (body !== undefined) init.body = JSON.stringify(body);
      res = await fetch(`${this.cfg.svixUrl}/api/v1/${path}`, init);
    } catch {
      throw new SvixUnavailable('svix unreachable');
    }
    if (res.status >= 500) throw new SvixUnavailable(`svix ${res.status}`);
    return res;
  }

  /** Creates or updates the client's Svix application; each client has one. */
  async ensureApp(appUid: string, name: string): Promise<void> {
    const listRes = await this.request(`app?uid=${encodeURIComponent(appUid)}`, 'GET');
    if (listRes.ok) {
      const page = (await listRes.json().catch(() => null)) as { data?: Array<{ uid: string }> } | null;
      if (page?.data?.some((a) => a.uid === appUid)) return;
    }
    const createRes = await this.request('app', 'POST', { uid: appUid, name });
    // 409 means the app already exists.
    if (!createRes.ok && createRes.status !== 409) throw new SvixUnavailable(`app create ${createRes.status}`);
  }

  /** Creates or updates the client's single endpoint, returning its signing secret. */
  async saveEndpoint(appUid: string, url: string): Promise<string> {
    await this.ensureApp(appUid, 'Spindrift client');
    const listRes = await this.request(`app/${appUid}/endpoint`, 'GET');
    let endpointId: string | null = null;
    if (listRes.ok) {
      const list = (await listRes.json()) as { data?: Array<{ id: string }> };
      endpointId = list.data?.[0]?.id ?? null;
    }
    if (endpointId) {
      const updateRes = await this.request(`app/${appUid}/endpoint/${endpointId}`, 'PATCH', { url });
      if (!updateRes.ok) throw new SvixUnavailable(`endpoint update ${updateRes.status}`);
    } else {
      const createRes = await this.request(`app/${appUid}/endpoint`, 'POST', { url });
      if (!createRes.ok) throw new SvixUnavailable(`endpoint create ${createRes.status}`);
      const created = (await createRes.json()) as { id: string };
      endpointId = created.id;
    }
    const secretRes = await this.request(`app/${appUid}/endpoint/${endpointId}/secret`, 'GET');
    if (!secretRes.ok) throw new SvixUnavailable('secret fetch failed');
    const secret = (await secretRes.json()) as { key: string };
    return secret.key;
  }

  async createMessage(appUid: string, eventId: string, eventType: string, payload: unknown): Promise<void> {
    const res = await this.request(`app/${appUid}/msg`, 'POST', { eventId, eventType, payload });
    if (!res.ok && res.status !== 409) throw new SvixUnavailable(`msg create ${res.status}`);
  }

  async listAttempts(appUid: string, eventId: string): Promise<SvixAttempt[]> {
    const res = await this.request(`app/${appUid}/msg/${encodeURIComponent(eventId)}/attempt`, 'GET');
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id: string; status: number; responseStatusCode: number | null; triggerType?: string }> };
    return (body.data ?? []).map((a) => ({
      id: a.id,
      status: a.status,
      responseStatusCode: a.responseStatusCode,
      at: new Date().toISOString(),
    }));
  }

  /** Derives the app's final delivery state from Svix's attempt statuses. */
  static finalState(attempts: SvixAttempt[]): SvixFinalState {
    if (attempts.length === 0) return 'pending';
    const success = attempts.some((a) => a.status === 0 || (a.responseStatusCode ?? 0) >= 200 && (a.responseStatusCode ?? 0) < 300);
    if (success) return 'delivered';
    const last = attempts[attempts.length - 1];
    if (!last) return 'pending';
    if (last.status === 2 || last.status === 3) return 'failed';
    return 'retrying';
  }
}
