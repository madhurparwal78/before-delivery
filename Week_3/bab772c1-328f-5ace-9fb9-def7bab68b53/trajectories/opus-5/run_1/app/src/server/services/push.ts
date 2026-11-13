/** ntfy: one best-effort push alert per parse outcome. */

import { config, DEPENDENCY_TIMEOUT_MS } from "../config.js";

export type PushAlert = {
  topic: string;
  title: string;
  message: string;
  priority: number;
  tags: string[];
  click?: string;
};

/** Publishes one alert; a failure is dropped and never retried. */
export async function publishAlert(alert: PushAlert): Promise<void> {
  const basic = Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString("base64");
  try {
    await fetch(`${config.ntfy.url}/`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS),
    });
  } catch {
    /* alerts are best effort */
  }
}
