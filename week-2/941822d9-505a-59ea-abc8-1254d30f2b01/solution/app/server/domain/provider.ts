import { db, one } from "../db.js";
import { providerDate } from "./time.js";

interface Provider {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  accreditationStatement: string;
}

/** The accredited provider, read from the seed at start-up before the server listens. */
export const provider: Provider = { id: "", slug: "", name: "", timeZone: "UTC", accreditationStatement: "" };

export async function loadProvider(): Promise<void> {
  const row = await one<{ id: string; slug: string; name: string; time_zone: string; accreditation_statement: string }>(
    db,
    "SELECT id, slug, name, time_zone, accreditation_statement FROM organisations WHERE kind = 'provider' ORDER BY slug LIMIT 1",
  );
  if (!row) throw new Error("the provider organisation is missing from the seed");
  Object.assign(provider, {
    id: row.id,
    slug: row.slug,
    name: row.name,
    timeZone: row.time_zone,
    accreditationStatement: row.accreditation_statement,
  });
}

/** Today in the provider's time zone at `instant`. */
export const providerToday = (instant: Date): string => providerDate(provider.timeZone, instant);
