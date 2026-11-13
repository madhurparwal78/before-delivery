// ntfy push alerts. Published once, best effort, never retried.

import { fetchWithTimeout, optionalEnv, requireEnv } from "./deps.js";

function base(): string {
  return requireEnv("NTFY_URL").replace(/\/$/, "");
}

export interface PushAlert {
  missionId: string;
  missionName: string;
  filename: string;
  outcome: "parsed" | "rejected";
  samples: number;
  lines: number;
  rejectedLine: number | null;
  reasonText: string;
  firstSampleMet: number | null;
}

export async function publishAlert(alert: PushAlert): Promise<void> {
  const topic = `perilune-${alert.missionId}`;
  let title: string;
  let message: string;
  let priority: number;
  let tags: string[];
  if (alert.outcome === "parsed") {
    title = `${alert.missionName}: pass parsed`;
    const samplesWord = alert.samples === 1 ? "1 sample" : `${alert.samples} samples`;
    const linesWord = alert.lines === 1 ? "1 transcript line" : `${alert.lines} transcript lines`;
    message = `${alert.filename}: ${samplesWord}, ${linesWord}.`;
    priority = 3;
    tags = ["white_check_mark"];
  } else if (alert.rejectedLine !== null) {
    title = `${alert.missionName}: pass rejected`;
    message = `${alert.filename}: line ${alert.rejectedLine}, ${alert.reasonText}.`;
    priority = 4;
    tags = ["warning"];
  } else {
    title = `${alert.missionName}: pass rejected`;
    message = `${alert.filename}: ${alert.reasonText}.`;
    priority = 5;
    tags = ["rotating_light"];
  }
  const publicUrl = optionalEnv("APP_PUBLIC_URL");
  let click: string | undefined;
  if (publicUrl) {
    if (alert.outcome === "parsed" && alert.firstSampleMet !== null) {
      click = `${publicUrl}/missions/${alert.missionId}?t=${alert.firstSampleMet}`;
    } else {
      click = `${publicUrl}/missions/${alert.missionId}`;
    }
  }
  const username = optionalEnv("NTFY_USERNAME");
  const password = optionalEnv("NTFY_PASSWORD");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (username && password !== undefined) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }
  const body: Record<string, unknown> = { topic, title, message, priority, tags };
  if (click) body.click = click;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(`${base()}/`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Best effort: dropped and never retried.
  }
}

export async function probePush(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${base()}/v1/health`, { method: "GET" }, 1000);
    return response.ok;
  } catch {
    return false;
  }
}
