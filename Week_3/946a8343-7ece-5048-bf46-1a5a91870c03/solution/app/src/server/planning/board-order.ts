// Which list a card shows in, what a move into another list changes, and where the card lands. Pure, so it is tested alone.

export type BoardKind = "label" | "assignee" | "milestone";

export interface ListDef {
  readonly id: number;
  readonly kind: "open" | "list" | "closed";
  readonly title: string;
  readonly ref: string | null;
}

export interface CardFacts {
  readonly state: "opened" | "closed";
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  readonly milestone: string | null;
}

function matches(kind: BoardKind, list: ListDef, card: CardFacts): boolean {
  if (list.ref === null) return false;
  if (kind === "label") return card.labels.includes(list.ref);
  if (kind === "assignee") return card.assignees.includes(list.ref);
  return card.milestone === list.ref;
}

/** An open issue shows in every list it matches, or in `Open` when it matches none. A closed issue shows only in `Closed`. */
export function listsOf(kind: BoardKind, lists: readonly ListDef[], card: CardFacts): number[] {
  if (card.state === "closed") return lists.filter((list) => list.kind === "closed").map((list) => list.id);
  const matching = lists.filter((list) => list.kind === "list" && matches(kind, list, card)).map((list) => list.id);
  if (matching.length > 0) return matching;
  return lists.filter((list) => list.kind === "open").map((list) => list.id);
}

interface MovePlan {
  /** The list whose field is taken away. */
  readonly remove: ListDef | null;
  /** The list whose field is put on. */
  readonly add: ListDef | null;
  readonly close: boolean;
  readonly reopen: boolean;
}

/** Moving into a list removes the field of the list the card left and adds the target's; into `Open` it only removes; into
 *  `Closed` it closes the issue; out of `Closed` it reopens it. */
export function planMove(kind: BoardKind, lists: readonly ListDef[], card: CardFacts, target: ListDef, from?: ListDef): MovePlan {
  const current = listsOf(kind, lists, card);
  const left = from ?? (current.includes(target.id) ? target : lists.find((list) => list.id === current[0]));
  if (target.kind === "closed") return { remove: null, add: null, close: card.state !== "closed", reopen: false };
  const reopen = card.state === "closed";
  const remove = left !== undefined && left.kind === "list" && left.id !== target.id ? left : null;
  const add = target.kind === "list" ? target : null;
  return { remove, add, close: false, reopen };
}

export interface RankedCard {
  readonly id: number;
  readonly position: number;
}

export const POSITION_STEP = 1024;

type Placement =
  | { readonly kind: "placed"; readonly position: number; readonly fellBack: boolean }
  | { readonly kind: "crowded" };

/** Where a card goes in a list (`members` sorted by position, without the card itself): after `afterId`, at the top for
 *  null, and at the end when that card is not in the list any more. `crowded` means the gap is too small to split. */
export function place(members: readonly RankedCard[], afterId: number | null, current: number): Placement {
  if (afterId === null) {
    const first = members[0];
    return { kind: "placed", position: first === undefined ? current : first.position - POSITION_STEP, fellBack: false };
  }
  const index = members.findIndex((member) => member.id === afterId);
  if (index === -1) {
    const last = members[members.length - 1];
    return { kind: "placed", position: last === undefined ? current : last.position + POSITION_STEP, fellBack: true };
  }
  const before = members[index];
  const next = members[index + 1];
  if (before === undefined) return { kind: "crowded" };
  if (next === undefined) return { kind: "placed", position: before.position + POSITION_STEP, fellBack: false };
  const middle = (before.position + next.position) / 2;
  if (!(middle > before.position && middle < next.position)) return { kind: "crowded" };
  return { kind: "placed", position: middle, fellBack: false };
}

export function byPosition<T extends RankedCard>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => a.position - b.position || a.id - b.id);
}
