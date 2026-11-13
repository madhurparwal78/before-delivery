let offsetMs = 0;

/** Estimates the gap between this device's clock and the server's. */
export async function measureServerOffset(): Promise<void> {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sent = Date.now();
    const response = await fetch('/api/time', { credentials: 'same-origin' });
    if (!response.ok) return;
    const received = Date.now();
    const body = (await response.json()) as { serverNow: number };
    const roundTrip = received - sent;
    if (roundTrip < best) {
      best = roundTrip;
      offsetMs = body.serverNow + roundTrip / 2 - received;
    }
  }
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}
