import { CREW_TOPIC, env } from '../env.js';

/** Crew alerts are posted to the crew topic. */

export class AlertsUnavailable extends Error {}

export type CrewAlertKind = 'slot_confirmed' | 'load_in_tomorrow' | 'placement_changed';

/**
 * Alerts are published as JSON: the published titles carry em dashes, which an
 * HTTP header cannot hold.
 */
export async function postCrewAlert(
  title: string,
  body: string,
  timeoutMs = 10_000,
): Promise<void> {
  const basic = Buffer.from(`${env.ntfyUsername}:${env.ntfyPassword}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.ntfyUrl}/`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        topic: CREW_TOPIC,
        title,
        message: body,
        tags: ['spindrift'],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new AlertsUnavailable(`post ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  } catch (error) {
    if (error instanceof AlertsUnavailable) throw error;
    throw new AlertsUnavailable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

export async function alertsAreUp(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`${env.ntfyUrl}/v1/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const json = (await res.json()) as { healthy?: boolean };
    return json.healthy === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
