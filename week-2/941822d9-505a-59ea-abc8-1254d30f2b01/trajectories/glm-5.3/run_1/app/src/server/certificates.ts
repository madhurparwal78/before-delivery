import type { PoolClient } from "pg";
import { config } from "./config.ts";
import { contactHoursHundredths } from "./money.ts";
import { providerDateOf } from "./time.ts";

// Certificate rules: awarded hours, serial, version states, the current-version
// rule and the name each copy carries live here and nowhere else.

export const awardedHoursH = (verifiedMinutes: number): number => contactHoursHundredths(verifiedMinutes);

export async function nextSerial(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ seq: string }>(
    `UPDATE certificate_sequence SET seq = seq + 1 WHERE id = 1 RETURNING seq::text AS seq`,
  );
  const row = rows[0];
  if (!row) throw new Error("certificate sequence missing");
  const issueYear = providerDateOf(new Date()).slice(0, 4);
  return `SPL-${issueYear}-${String(row.seq).padStart(6, "0")}`;
}

export const pdfKey = (serial: string, version: number): string => `certificates/sorrel-pike/${serial}/v${version}.pdf`;

/**
 * The current version is the newest sealed or revoked version, or version 1
 * while no version has been sealed yet.
 */
export function currentVersionOf(versions: Array<{ version: number; state: string }>): number {
  const settled = versions.filter((v) => v.state === "sealed" || v.state === "revoked");
  if (settled.length === 0) return 1;
  return Math.max(...settled.map((v) => v.version));
}

export const downloadLinkTtlSeconds = (): number => config.timings.downloadLinkTtlSeconds;
export const shareLinkTtlSeconds = (): number => config.timings.shareLinkTtlSeconds;

