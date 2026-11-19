import { config } from '../config';
import type { AlertKind } from '../../shared/types';

const TIMEOUT_MS = 3_000;

/** A phone alert carries only its published message and title. */
export const ALERT_MESSAGE: Record<AlertKind, string> = {
  viewing_claim: 'New viewing claim',
  new_offer: 'New offer',
  offer_lapsing: 'Offer about to lapse',
};

/** True only when ntfy answered 2xx. */
export const publishAlert = async (kind: AlertKind): Promise<boolean> => {
  const authorisation = Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString('base64');
  try {
    const response = await fetch(`${config.ntfy.url}/${config.ntfy.topic}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorisation}`,
        Title: 'Open Bonnet',
        'Content-Type': 'text/plain',
      },
      body: ALERT_MESSAGE[kind],
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};
