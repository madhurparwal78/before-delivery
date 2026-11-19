// Valid-through dates per document type, and the insurance rule that gates holds, series and check-in.
import { one, type Db } from "./db.ts";
import type { IsoDate } from "../shared/time.ts";
import { validThroughLapsed } from "../shared/rules.ts";
import type { DocumentType, ValidThrough } from "../shared/api.ts";

/** For each type: the latest expiry among verified documents, or the seeded date if that is later. */
export async function validThrough(db: Db, memberId: string): Promise<ValidThrough> {
  const row = await one<Record<DocumentType, IsoDate | null>>(
    db,
    `SELECT
       GREATEST(m.seeded_certificate_of_insurance,
         (SELECT MAX(expiry_date) FROM documents WHERE member_id = m.id AND status = 'verified' AND type = 'certificate_of_insurance'))
         AS certificate_of_insurance,
       GREATEST(m.seeded_food_handler_certificate,
         (SELECT MAX(expiry_date) FROM documents WHERE member_id = m.id AND status = 'verified' AND type = 'food_handler_certificate'))
         AS food_handler_certificate,
       GREATEST(m.seeded_business_licence,
         (SELECT MAX(expiry_date) FROM documents WHERE member_id = m.id AND status = 'verified' AND type = 'business_licence'))
         AS business_licence
     FROM members m WHERE m.id = $1`,
    [memberId],
  );
  return {
    certificate_of_insurance: row?.certificate_of_insurance ?? null,
    food_handler_certificate: row?.food_handler_certificate ?? null,
    business_licence: row?.business_licence ?? null,
  };
}

/** Insurance is valid through 23:59:59 on its valid-through date in the booking site's zone. */
export function insuranceValidNow(insurance: IsoDate | null, siteToday: IsoDate): boolean {
  return insurance !== null && !validThroughLapsed(insurance, siteToday);
}

/** The booked dates the certificate does not cover: all of them when it is not valid now. */
export function uncoveredDates(insurance: IsoDate | null, siteToday: IsoDate, dates: IsoDate[]): IsoDate[] {
  if (insurance === null || !insuranceValidNow(insurance, siteToday)) return dates;
  return dates.filter((date) => date > insurance);
}
