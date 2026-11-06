// Publishing a restatement: one transaction that publishes it, supersedes the week it corrects,
// stores the four figures and marks the superseded computations restated.

import { currentHoldings, markRestated, storeFigures } from "./computations.ts";
import { applyChange, findRestatement, type Restatement } from "./restatements.ts";
import type { Queryable } from "./db.ts";
import { FIGURE_KEYS } from "../shared/domain.ts";
import { newYorkDate } from "../shared/newyork.ts";

interface Publication {
  at: number;
  /** The officer who released it just now; null when the server publishes a queued release at its close. */
  actorId: string | null;
}

/** Callers hold the ledger lock and the row lock of `current`. */
export async function publishRestatement(q: Queryable, current: Restatement, publication: Publication): Promise<Restatement> {
  const { at, actorId } = publication;
  const superseded = current.supersedes ? await findRestatement(q, current.supersedes, true) : null;
  if (superseded) {
    await applyChange(q, superseded, {
      action: "supersede",
      actorId: null,
      at,
      toState: "superseded",
      note: current.correctionReason,
      set: { superseded_by: current.id },
    });
  }
  const published = await applyChange(q, current, {
    action: "publish",
    actorId,
    at,
    toState: "published",
    set: actorId === null ? { published_at: at } : { published_at: at, released_by: actorId },
  });
  const holdings = await currentHoldings(q);
  if (!holdings || holdings.restatementId !== published.id) throw new Error("published restatement is not the current holdings");
  const stored = await storeFigures(q, FIGURE_KEYS, at, "publication", holdings);
  if (superseded && current.correctionReason !== null) {
    await markRestated(q, superseded.id, published.id, newYorkDate(at), current.correctionReason, stored);
  }
  return published;
}
