import { hub as hubDef, model as modelDef, type HubId, type ModelId } from '../../shared/catalogue.js';
import { labelDddDMon, labelHmm } from '../clock.js';

const TIMEOUT_MS = 3_000;

export class NoticeFailed extends Error {
  constructor() {
    super('phone notice not accepted');
    this.name = 'NoticeFailed';
  }
}

export function topicOf(riderId: string): string {
  return `malhar-${riderId}`;
}

/** A notice counts as sent only on a 200 reply. */
export async function publishNotice(
  riderId: string,
  title: string,
  message: string,
): Promise<void> {
  const base = process.env.NTFY_URL;
  if (!base) throw new NoticeFailed();
  const username = process.env.NTFY_USERNAME ?? '';
  const password = process.env.NTFY_PASSWORD ?? '';
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  let response: Response;
  try {
    response = await fetch(`${base}/${topicOf(riderId)}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Title: title,
        'Content-Type': 'text/plain',
      },
      body: message,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new NoticeFailed();
  }
  if (response.status !== 200) throw new NoticeFailed();
}

export const NOTICE_COPY = {
  optIn: () => ({
    title: 'Reminders on',
    message: 'Key-On will send lock and ride notices here.',
  }),
  lockEnding: (model: ModelId, hub: HubId, expiresAt: Date) => ({
    title: 'Price lock ends today',
    message: `Your ${modelDef(model).name} price lock at ${hubDef(hub).name} ends at ${labelHmm(
      expiresAt,
    )} IST today.`,
  }),
  rideReminder: (model: ModelId, hub: HubId, startsAt: Date) => ({
    title: 'Test ride tomorrow',
    message: `Your ${modelDef(model).name} ride at ${hubDef(hub).name} is tomorrow at ${labelHmm(
      startsAt,
    )} IST.`,
  }),
  deliveryPlace: (model: ModelId, hub: HubId, date: string) => ({
    title: 'Delivery day set',
    message: `A place opened at ${hubDef(hub).name}. Your ${modelDef(model).name} handover is on ${labelDddDMon(
      date,
    )}.`,
  }),
};
