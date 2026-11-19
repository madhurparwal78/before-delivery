export class ApiRequest {
  static async send(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string; raw?: boolean } = {}): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = {};
    let payload: string | undefined;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    const res = await fetch(path, {
      method, headers, body: payload,
      credentials: 'same-origin'
    });
    let data: any = null;
    if (opts.raw) {
      data = await res.arrayBuffer();
    } else {
      const text = await res.text();
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
    }
    return { status: res.status, data };
  }

  static get(path: string): Promise<{ status: number; data: any }> { return this.send('GET', path); }
  static post(path: string, body?: unknown, opts?: { idempotencyKey?: string }): Promise<{ status: number; data: any }> {
    return this.send('POST', path, body, opts);
  }
  static patch(path: string, body?: unknown): Promise<{ status: number; data: any }> { return this.send('PATCH', path, body); }
  static del(path: string): Promise<{ status: number; data: any }> { return this.send('DELETE', path); }
}

export function errorText(data: any): string | null {
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string') return data.error;
    if (data.errors && typeof data.errors === 'object') {
      const first = Object.values(data.errors)[0] as string | undefined;
      if (first) return first;
    }
  }
  return null;
}
