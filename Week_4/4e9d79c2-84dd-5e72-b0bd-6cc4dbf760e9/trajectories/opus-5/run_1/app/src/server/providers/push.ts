import { config } from '../config.js';
import { foldTelephone } from '../../domain/text.js';

const TIMEOUT_MS = 5000;

export class PushDown extends Error {}

export function driverTopic(telephone: string): string {
  return `driver-${foldTelephone(telephone)}`;
}

/** ntfy carries the driver's push. `toldAt` is set only after ntfy accepts. */
export async function publishToDriver(telephone: string, title: string, message: string): Promise<void> {
  const authorization = `Basic ${Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString('base64')}`;
  let answer: Response;
  try {
    answer = await fetch(`${config.ntfy.url}/${driverTopic(telephone)}`, {
      method: 'POST',
      headers: { authorization, title, 'content-type': 'text/plain; charset=utf-8' },
      body: message,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PushDown("the driver's phone was not reached");
  }
  if (!answer.ok) throw new PushDown(`ntfy answered ${answer.status}`);
}
