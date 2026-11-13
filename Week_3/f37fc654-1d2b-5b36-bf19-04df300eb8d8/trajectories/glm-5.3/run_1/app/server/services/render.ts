import type { Config } from '../config.js';

export interface RenderSubmitBody {
  jobRef: string;
  installationType: string;
  room: { widthM: number; depthM: number; doorWall: string };
  layout: Array<{ kind: string; x: number; y: number; rotationDeg: number }> | null;
  brief: { title: string; audience: string; notes: string | null };
  venuePhoto: { contentType: string; sizeBytes: number; sha256: string; base64: string };
  referenceImage: { sourceUrl: string; contentType: string; sha256: string; base64: string } | null;
  callbackUrl: string;
}

export interface RenderSubmitResult {
  ok: boolean;
  providerJobId?: string;
  rejected?: boolean;
}

export class RenderProviderUnavailable extends Error {}

export class RenderProvider {
  constructor(private cfg: Config) {}

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.wiremockUrl}/v1/renders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async submit(body: RenderSubmitBody): Promise<RenderSubmitResult> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.wiremockUrl}/v1/renders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': body.jobRef },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new RenderProviderUnavailable('render provider unreachable');
    }
    if (res.status >= 500) throw new RenderProviderUnavailable(`render provider ${res.status}`);
    if (res.status >= 400) return { ok: false, rejected: true };
    const json = (await res.json().catch(() => ({}))) as { providerJobId?: string };
    return json.providerJobId === undefined ? { ok: true } : { ok: true, providerJobId: json.providerJobId };
  }
}
