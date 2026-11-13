import { env } from '../env.js';
import type { DoorWall, InstallationType } from '../../shared/seed.js';
import type { LayoutItem } from '../../shared/placement.js';

/** The generative-AI render provider that draws concept previews. */

export class RenderProviderUnavailable extends Error {}
export class RenderProviderRejected extends Error {}

export interface RenderSubmission {
  jobRef: string;
  installationType: InstallationType;
  room: { widthM: number; depthM: number; doorWall: DoorWall };
  layout: LayoutItem[] | null;
  brief: { title: string; audience: string; notes: string };
  venuePhoto: { contentType: string; sizeBytes: number; sha256: string; base64: string };
  referenceImage: { sourceUrl: string; contentType: string; sha256: string; base64: string } | null;
  callbackUrl: string;
}

export interface RenderAccepted {
  providerJobId: string;
  status: string;
  etaSeconds: number;
}

export function callbackUrl(): string {
  return `${env.publicUrl}/api/render-callbacks`;
}

/**
 * Submit a render. The job reference is the provider's idempotency key, so a
 * retried submission never starts a second render.
 */
export async function submitRender(
  submission: RenderSubmission,
  timeoutMs = 10_000,
): Promise<RenderAccepted> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${env.wiremockUrl}/v1/renders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': submission.jobRef,
      },
      body: JSON.stringify(submission),
      signal: controller.signal,
    });
  } catch (error) {
    throw new RenderProviderUnavailable(String(error));
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500) throw new RenderProviderUnavailable(`submit ${res.status}`);
  if (res.status >= 400) throw new RenderProviderRejected(`submit ${res.status}`);
  const json = (await res.json()) as Partial<RenderAccepted>;
  return {
    providerJobId: String(json.providerJobId ?? ''),
    status: String(json.status ?? 'accepted'),
    etaSeconds: Number(json.etaSeconds ?? 0),
  };
}

export async function renderProviderIsUp(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`${env.wiremockUrl}/v1/renders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'health-probe' },
      body: JSON.stringify({ jobRef: 'health-probe', probe: true }),
      signal: controller.signal,
    });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
