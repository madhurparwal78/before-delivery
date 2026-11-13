// ntfy: founder push alerts on the gloamwork-studio topic.
import { config } from "./config.js";

const FOUNDER_TOPIC = "gloamwork-studio";
export type Push = { title: string; message: string };

const AUTH = `Basic ${Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString("base64")}`;

export async function sendPush(push: Push): Promise<void> {
  const response = await fetch(config.ntfy.url, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ topic: FOUNDER_TOPIC, title: push.title, message: push.message }),
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`ntfy answered ${response.status}`);
}

export async function pushReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.ntfy.url}/v1/health`, { signal: AbortSignal.timeout(3_000) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
