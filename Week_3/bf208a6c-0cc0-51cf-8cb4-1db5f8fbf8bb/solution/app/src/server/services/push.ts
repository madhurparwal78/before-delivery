import { config } from "../config";
import { report } from "./status";

const TIMEOUT_MS = 5000;
const authorization = `Basic ${Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString("base64")}`;

/** Publishes one message to ntfy. The push counts as sent only when ntfy answers 200. */
export async function publish(topic: string, title: string, message: string): Promise<boolean> {
  try {
    const response = await fetch(config.ntfy.url, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ topic, title, message }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    report("push", response.status === 200);
    return response.status === 200;
  } catch {
    report("push", false);
    return false;
  }
}

export async function ping(): Promise<void> {
  const response = await fetch(`${config.ntfy.url}/v1/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status !== 200) throw new Error(`ntfy answered ${response.status}`);
}
