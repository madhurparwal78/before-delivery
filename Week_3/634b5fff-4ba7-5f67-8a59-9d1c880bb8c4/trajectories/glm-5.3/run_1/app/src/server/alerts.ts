import { config } from './config.js';

export class NtfyDown extends Error {}

const topic = config.namespace ? `${config.namespace}-svovlstik-maker` : 'svovlstik-maker';

export async function pushAlert(title: string, body: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const headers: Record<string, string> = {
      'content-type': 'text/plain; charset=utf-8',
      Title: title,
    };
    const url = `${config.ntfy.url}/${topic}`;
    const auth = config.ntfy.username && config.ntfy.password
      ? 'Basic ' + Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString('base64')
      : null;
    if (auth) headers.authorization = auth;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    if (res.status >= 500) throw new NtfyDown(`ntfy ${res.status}`);
  } catch (err) {
    if (err instanceof NtfyDown) throw err;
    throw new NtfyDown(String(err));
  } finally {
    clearTimeout(timer);
  }
}
