// Member households: names and emails for billing accounts, receipts and bags.
import { all, one } from "./db.js";

export interface HouseholdRow {
  code: string;
  name: string;
  email: string;
}

export function householdRow(code: string): HouseholdRow | undefined {
  return one<HouseholdRow>("SELECT code, name, email FROM households WHERE code = ?", code);
}

export function households(): HouseholdRow[] {
  return all<HouseholdRow>("SELECT code, name, email FROM households ORDER BY code");
}
