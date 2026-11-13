// This app copy's latest findings for each service, reported by GET /api/status.
// Each copy checks search (with the index check), storage and printing itself.

import { meiliUp } from "./search.js";
import { storageUp } from "./storage.js";
import { gotenbergUp } from "./printing.js";

export const statuses: { search: boolean; storage: boolean; printing: boolean } = {
  search: false, storage: false, printing: false,
};

const gotenbergUrl = process.env.GOTENBERG_URL!;

export async function checkAll(): Promise<void> {
  statuses.search = await meiliUp();
  statuses.storage = await storageUp();
  statuses.printing = await gotenbergUp(gotenbergUrl);
}
