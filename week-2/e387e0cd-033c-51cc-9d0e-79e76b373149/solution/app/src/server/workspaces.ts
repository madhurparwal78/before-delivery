// The two workspaces, read once from PostgreSQL after the seed has run.
import { rows, pool } from "./db.js";

export interface Workspace {
  slug: string;
  name: string;
  legalName: string;
  lei: string;
  jurisdictionCode: string;
  timeZone: string;
  city: string;
  currency: string;
  confirmationLimitCents: bigint;
  casePrefix: string;
  sendingAddress: string;
  firstBusinessDate: string;
}

const loaded = new Map<string, Workspace>();

export async function loadWorkspaces(): Promise<void> {
  const found = await rows<{
    slug: string; name: string; legal_name: string; lei: string; jurisdiction_code: string; time_zone: string; city: string;
    currency: string; confirmation_limit_cents: bigint; case_prefix: string; sending_address: string; first_business_date: string;
  }>(pool, "SELECT * FROM workspaces");
  for (const w of found) {
    loaded.set(w.slug, {
      slug: w.slug, name: w.name, legalName: w.legal_name, lei: w.lei, jurisdictionCode: w.jurisdiction_code,
      timeZone: w.time_zone, city: w.city, currency: w.currency, confirmationLimitCents: w.confirmation_limit_cents,
      casePrefix: w.case_prefix, sendingAddress: w.sending_address, firstBusinessDate: w.first_business_date,
    });
  }
}

export function workspaceBySlug(slug: string | undefined): Workspace | undefined {
  return slug === undefined ? undefined : loaded.get(slug);
}
