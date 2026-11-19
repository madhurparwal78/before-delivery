import type { AppConfig } from './config.js';

export class SvixClient {
  constructor(private readonly config: AppConfig) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.svix.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private url(path: string): string {
    return `${this.config.svix.url.replace(/\/$/, '')}/api/v1/${path.replace(/^\//, '')}`;
  }

  async createApplication(appUid: string, name: string): Promise<{ id: string }> {
    const res = await fetch(this.url('app/'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ uid: appUid, name }),
    });
    if (!res.ok) throw new Error(`svix app create failed ${res.status}`);
    const data = (await res.json()) as { id: string };
    return data;
  }

  async ensureApplication(appUid: string, name: string): Promise<{ id: string }> {
    const get = await fetch(this.url(`app/${appUid}/`), { method: 'GET', headers: this.headers() });
    if (get.ok) return (await get.json()) as { id: string };
    // POST to the collection; a uid that already exists answers 409.
    return this.createApplication(appUid, name);
  }

  async createEndpoint(appUid: string, endpointUid: string, url: string): Promise<{ id: string; secret: string }> {
    const res = await fetch(this.url(`app/${appUid}/endpoint/`), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ uid: endpointUid, url, channels: [endpointUid] }),
    });
    if (res.status === 409) {
      const updated = await this.updateEndpoint(appUid, endpointUid, url);
      return updated;
    }
    if (!res.ok) throw new Error(`svix endpoint create failed ${res.status}`);
    return (await res.json()) as { id: string; secret: string };
  }

  async endpointExists(appUid: string, endpointUid: string): Promise<boolean> {
    const res = await fetch(this.url(`app/${appUid}/endpoint/${endpointUid}/`), { method: 'GET', headers: this.headers() });
    return res.ok;
  }

  async updateEndpoint(appUid: string, endpointUid: string, url: string): Promise<{ id: string; secret: string }> {
    const res = await fetch(this.url(`app/${appUid}/endpoint/${endpointUid}/`), {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ uid: endpointUid, url, channels: [endpointUid] }),
    });
    if (!res.ok) throw new Error(`svix endpoint update failed ${res.status}`);
    return (await res.json()) as { id: string; secret: string };
  }

  async deleteEndpoint(appUid: string, endpointUid: string): Promise<void> {
    const res = await fetch(this.url(`app/${appUid}/endpoint/${endpointUid}/`), {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) throw new Error(`svix endpoint delete failed ${res.status}`);
  }

  async getEndpointSecret(appUid: string, endpointUid: string): Promise<string> {
    const res = await fetch(this.url(`app/${appUid}/endpoint/${endpointUid}/secret/`), { method: 'GET', headers: this.headers() });
    if (!res.ok) throw new Error(`svix secret failed ${res.status}`);
    const data = (await res.json()) as { key: string };
    return data.key;
  }

  async sendMessage(appUid: string, payload: Record<string, unknown>): Promise<{ id: string }> {
    const body = JSON.stringify({
      eventId: String(payload['event_id']),
      eventType: String(payload['type']),
      payload,
      channels: [String(payload['channel'])],
    });
    const res = await fetch(this.url(`app/${appUid}/msg/`), {
      method: 'POST',
      headers: this.headers(),
      body,
    });
    if (!res.ok) throw new Error(`svix send failed ${res.status}`);
    return (await res.json()) as { id: string };
  }

  async listApplications(): Promise<unknown[]> {
    const res = await fetch(this.url('app/?limit=1'), { headers: this.headers() });
    if (!res.ok) throw new Error(`svix apps failed ${res.status}`);
    const data = (await res.json()) as { data?: unknown[] };
    return data.data ?? [];
  }

  async listAttempts(appUid: string, endpointId: string): Promise<unknown[]> {
    const res = await fetch(this.url(`app/${appUid}/attempt/endpoint/${encodeURIComponent(endpointId)}?limit=50`), {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`svix attempts failed ${res.status}`);
    const data = (await res.json()) as { data?: unknown[] };
    return data.data ?? [];
  }
}
