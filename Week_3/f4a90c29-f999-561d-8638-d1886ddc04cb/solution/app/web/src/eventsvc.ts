import { ApiError, describe, send } from "./api";
import { announce } from "./status";
import { bump } from "./state";
import { Store } from "./store";
import type { Item } from "./types";

export type Scope = "this" | "following" | "all";

export interface ScopeAsk {
  kind: "edit" | "delete";
  title: string;
  resolve: (scope: Scope | null) => void;
}

interface ConflictAsk {
  current: Item;
  winner: string;
  resolve: (choice: "reapply" | "keep") => void;
}

interface UndoOffer {
  title: string;
  eventId: string;
  version: number | null;
  trashId: string | null;
}

export const scopeAsk$ = new Store<ScopeAsk | null>(null);
export const conflictAsk$ = new Store<ConflictAsk | null>(null);
export const undo$ = new Store<UndoOffer | null>(null);

export function askScope(kind: "edit" | "delete", title: string): Promise<Scope | null> {
  return new Promise((resolve) =>
    scopeAsk$.set({
      kind,
      title,
      resolve: (scope) => {
        scopeAsk$.set(null);
        resolve(scope);
      },
    }),
  );
}

function askConflict(current: Item, message: string): Promise<"reapply" | "keep"> {
  return new Promise((resolve) =>
    conflictAsk$.set({
      current,
      winner: message.replace(/ saved this first\.$/, ""),
      resolve: (choice) => {
        conflictAsk$.set(null);
        resolve(choice);
      },
    }),
  );
}

let undoTimer: ReturnType<typeof setTimeout> | undefined;

export function offerUndo(offer: UndoOffer): void {
  clearTimeout(undoTimer);
  undo$.set(offer);
  undoTimer = setTimeout(() => undo$.set(null), 10000);
}

export function clearUndo(): void {
  clearTimeout(undoTimer);
  undo$.set(null);
}

interface Split {
  earlier_id: string;
  later_id: string;
}

interface Saved {
  event: Item;
  split: Split | null;
}

interface SaveInput {
  id: string;
  title: string;
  version: number;
  patch: Record<string, unknown>;
  scope?: Scope;
  occurrenceId?: string;
  quiet?: boolean;
}

const known = new Map<string, number>();

/** The newest version this browser has seen for an event, which a redraw may not have caught up with yet. */
export function versionFor(id: string, listed: number): number {
  return Math.max(known.get(id) ?? 0, listed);
}

/** Runs a versioned request; the loser of a simultaneous save chooses to reapply or keep the saved values (null). */
async function retryOnConflict<T>(version: number, run: (version: number) => Promise<T>): Promise<T | null> {
  let current = version;
  for (;;) {
    try {
      return await run(current);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 412) throw error;
      const winner = error.current as Item;
      if ((await askConflict(winner, error.message)) === "keep") {
        announce(`Kept the saved values for ${winner.title}.`);
        bump();
        return null;
      }
      current = winner.version as number;
    }
  }
}

/** Saves a change, asking the loser of a simultaneous save what to do. Null means the saved values were kept. */
export async function saveEvent(input: SaveInput): Promise<Saved | null> {
  if (!input.quiet) announce(`Saving ${input.title}...`);
  try {
    return await retryOnConflict(input.version, async (version) => {
      const body = { ...input.patch, scope: input.scope, occurrence_id: input.occurrenceId };
      const saved = (await send<Saved>("PATCH", `/api/events/${input.id}`, body, version)).data;
      known.set(saved.event.id as string, saved.event.version as number);
      return saved;
    });
  } catch (error) {
    announce(describe(error));
    throw error;
  }
}

export async function trashEvent(item: Item, scope: Scope | undefined, occurrenceId: string | undefined): Promise<boolean> {
  const id = (item.event_id ?? item.id) as string;
  announce(`Moving ${item.title} to trash...`);
  try {
    const reply = await retryOnConflict(item.version as number, async (version) => {
      const query = new URLSearchParams();
      if (scope) query.set("scope", scope);
      if (occurrenceId) query.set("occurrence_id", occurrenceId);
      return (await send<{ trash_id: string }>("DELETE", `/api/events/${id}?${query}`, undefined, version)).data;
    });
    if (!reply) return false;
    announce(`Moved ${item.title} to trash.`);
    if (scope === "following") clearUndo();
    else offerUndo({ title: item.title, eventId: id, version: null, trashId: reply.trash_id });
    bump();
    return true;
  } catch (error) {
    announce(describe(error));
    return false;
  }
}

export async function duplicateEvent(item: Item): Promise<Item | null> {
  announce(`Duplicating ${item.title}...`);
  try {
    const reply = await send<Item>("POST", `/api/events/${item.event_id ?? item.id}/duplicate`);
    announce(`Duplicated ${item.title}.`);
    bump();
    return reply.data;
  } catch (error) {
    announce(describe(error));
    return null;
  }
}

export async function undoLast(): Promise<void> {
  const offer = undo$.get();
  if (!offer) return;
  clearUndo();
  try {
    if (offer.trashId) {
      announce(`Restoring ${offer.title}...`);
      await send("POST", `/api/trash/${offer.trashId}/restore`);
    } else {
      announce(`Saving ${offer.title}...`);
      const done = await retryOnConflict(offer.version as number, (version) => send("POST", `/api/events/${offer.eventId}/undo`, undefined, version));
      if (!done) return;
    }
    announce(`Undid the last change to ${offer.title}.`);
    bump();
  } catch (error) {
    announce(describe(error));
  }
}
