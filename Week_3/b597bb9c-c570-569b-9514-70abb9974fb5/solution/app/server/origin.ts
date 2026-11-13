import { config } from "./config";

const publicHost = new URL(config.publicUrl).host;

/** A request with no Origin is not a browser cross-site request; otherwise the origin must be this app's own. */
export function isOwnOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  try {
    const found = new URL(origin).host;
    return found === host || found === publicHost;
  } catch {
    return false;
  }
}
