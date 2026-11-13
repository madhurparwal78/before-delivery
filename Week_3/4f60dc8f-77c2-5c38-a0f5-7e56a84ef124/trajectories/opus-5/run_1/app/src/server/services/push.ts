import { config } from '../config.js';

export class PushUnavailable extends Error {}

export type Push = { title: string; message: string };

export const pushUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${config.ntfy.url}/v1/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    await response.arrayBuffer().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
};

export const sendPush = async (push: Push): Promise<void> => {
  const headers: Record<string, string> = { Title: push.title, 'Content-Type': 'text/plain' };
  if (config.ntfy.username !== '')
    headers.Authorization = `Basic ${Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString('base64')}`;
  let response: Response;
  try {
    response = await fetch(`${config.ntfy.url}/${config.ntfy.topic}`, {
      method: 'POST',
      headers,
      body: push.message,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new PushUnavailable('ntfy unreachable');
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new PushUnavailable(`ntfy responded ${response.status}`);
  }
  await response.arrayBuffer().catch(() => undefined);
};
