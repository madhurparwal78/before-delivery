import type { ParseLimits } from "./mortise.js";

/** What the server tells the browser through the page; never credentials. */
export interface PageConfig {
  parseDelayMs: number;
  limits: ParseLimits;
  timeZone: string;
  notFound: boolean;
  signedIn: boolean;
}

export const PAGE_CONFIG_ID = "joinery-config";
