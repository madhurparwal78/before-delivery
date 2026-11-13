import { randomBytes } from 'node:crypto';

/**
 * Svix signs and delivers stockist messages. The app talks to Svix's REST API
 * over HTTP with its bearer key and never signs anything itself.
 */

export interface SvixAttempt {
  id: string;
  responseStatusCode: number;
  status: number; // 0 Success, 1 Pending, 2 Fail, 3 Sending
  timestamp: string | Date;
  /** The eventId the app sent for the message this attempt belongs to. */
  eventId: string;
}

export class SvixService {
  private lastContactOk = true;

  constructor(
    private baseUrl: string,
    private apiKey: string
  ) {}

  private appPath(accountId: string): string {
    return `/api/v1/app/stockist-${accountId}`;
  }

  /** Every call runs against a 5-second wall; a late or absent answer counts as failed contact. */
  private async request<T>(path: string, init?: { method?: string; body?: unknown; acceptConflict?: boolean }): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const res = await Promise.race([
        fetch(`${this.baseUrl}${path}`, {
          method: init?.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 5000);
        }),
      ]);
      if (res === null) {
        this.lastContactOk = false;
        return null;
      }
      if (res.status >= 500) {
        this.lastContactOk = false;
        return null;
      }
      // Any other answer proves the service is up.
      this.lastContactOk = true;
      if (!res.ok) {
        // An app that already exists answers 409; that is the getOrCreate result.
        if (init?.acceptConflict && res.status === 409) return {} as T;
        return null;
      }
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    } catch {
      this.lastContactOk = false;
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  get reachable(): boolean {
    return this.lastContactOk;
  }

  async contactCheck(): Promise<boolean> {
    await this.request<unknown>('/api/v1/app?limit=1');
    return this.lastContactOk;
  }

  async ensureApplication(accountId: string): Promise<boolean> {
    // Application create is one per stockist, created as needed, with uid
    // `stockist-<accountId>`; an existing app answers 409, which is the
    // getOrCreate result.
    const r = await this.request<{ id: string }>('/api/v1/app', {
      method: 'POST',
      body: { uid: `stockist-${accountId}`, name: `stockist-${accountId}` },
      acceptConflict: true,
    });
    return r !== null;
  }

  async createEndpoint(accountId: string, url: string, secret: string): Promise<string | null> {
    const r = await this.request<{ id: string }>(`${this.appPath(accountId)}/endpoint`, {
      method: 'POST',
      body: { url, secret },
    });
    return r?.id ?? null;
  }

  async rotateSecret(accountId: string, svixEndpointId: string): Promise<boolean> {
    const r = await this.request<unknown>(`${this.appPath(accountId)}/endpoint/${svixEndpointId}/secret/rotate`, {
      method: 'POST',
      body: {},
    });
    return r !== null;
  }

  async deleteEndpoint(accountId: string, svixEndpointId: string): Promise<boolean> {
    const r = await this.request<unknown>(`${this.appPath(accountId)}/endpoint/${svixEndpointId}`, {
      method: 'DELETE',
    });
    return r !== null;
  }

  async sendMessage(accountId: string, eventId: string, eventType: string, payload: Record<string, unknown>): Promise<boolean> {
    const r = await this.request<{ id: string }>(`${this.appPath(accountId)}/msg`, {
      method: 'POST',
      body: { eventType, eventId, payload },
    });
    return r !== null;
  }

  async resend(accountId: string, svixEndpointId: string, msgId: string): Promise<boolean> {
    const r = await this.request<unknown>(`${this.appPath(accountId)}/endpoint/${svixEndpointId}/msg/${encodeURIComponent(msgId)}/resend`, {
      method: 'POST',
      body: {},
    });
    return r !== null;
  }

  /** Attempts for one endpoint, following pagination up to a bound. */
  async listAttempts(accountId: string, svixEndpointId: string): Promise<SvixAttempt[]> {
    const out: SvixAttempt[] = [];
    // The endpoint's messages first, then each message's attempts.
    let iterator: string | null = null;
    const msgIds: Array<{ id: string; eventId: string }> = [];
    for (let page = 0; page < 10; page++) {
      const suffix: string = iterator ? `?iterator=${encodeURIComponent(iterator)}&limit=100` : '?limit=100';
      const r = await this.request<{ data: Array<{ id: string; eventId: string }>; done: boolean; iterator: string | null }>(
        `${this.appPath(accountId)}/endpoint/${svixEndpointId}/msg${suffix}`
      );
      if (!r) return out;
      for (const m of r.data ?? []) msgIds.push({ id: m.id, eventId: m.eventId });
      if (r.done === false && r.iterator && (r.data?.length ?? 0) > 0 && r.iterator !== iterator) {
        iterator = r.iterator;
      } else break;
    }
    for (const m of msgIds) {
      const a = await this.request<{ data: Array<Omit<SvixAttempt, 'eventId'>> }>(
        `${this.appPath(accountId)}/msg/${m.id}/attempt?limit=100`
      );
      if (!a) continue;
      for (const it of a.data ?? []) out.push({ ...it, eventId: m.eventId });
    }
    return out;
  }
}

export function newSigningSecret(): string {
  return `whsec_${randomBytes(24).toString('base64')}`;
}

export function testEventId(endpointId: string): string {
  return `test-${endpointId}-${randomBytes(8).toString('hex')}`;
}

export const MESSAGE_STATUS = { SUCCESS: 0, PENDING: 1, FAIL: 2, SENDING: 3 } as const;

export function attemptSucceeded(a: SvixAttempt): boolean {
  return a.status === MESSAGE_STATUS.SUCCESS;
}

export function attemptPending(a: SvixAttempt): boolean {
  return a.status === MESSAGE_STATUS.PENDING || a.status === MESSAGE_STATUS.SENDING;
}
