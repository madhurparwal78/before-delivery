import { config, named } from "./config.js";

/** ntfy: push alerts to the maker's phone. */

class NtfyUnreachable extends Error {
  constructor() {
    super("ntfy unreachable");
  }
}

export const publishAlert = async (title: string, message: string): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(config.ntfy.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${config.ntfy.username}:${config.ntfy.password}`).toString("base64")}`,
      },
      body: JSON.stringify({ topic: named("svovlstik-maker"), title, message }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new NtfyUnreachable();
  }
  if (!response.ok) throw new NtfyUnreachable();
};
