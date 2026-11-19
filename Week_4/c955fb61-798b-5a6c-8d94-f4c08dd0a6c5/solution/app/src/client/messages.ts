import { formatLong, type IsoDate } from "../shared/calendar";
import { workingDays } from "../shared/format";
import { LINK_TYPE_WORDS, type Item, type LinkType, type Moved } from "../shared/types";
import { ApiFailure } from "./api";

export const READ_ONLY = "You can view this project but not change it.";
export const SAVE_FAILED = "Your change could not be saved. Try again.";
const STORAGE_OUTAGE = "File storage is unavailable. Your export was not saved. Try again later.";

const FIELD_MESSAGES: Record<string, string> = {
  name: "Name must be 1 to 120 characters.",
  start: "Enter a date as YYYY-MM-DD.",
  duration: "Duration must be a whole number from 0 to 999.",
  percent: "Percent complete must be a whole number from 0 to 100.",
  hours: "Hours a day must be from 0.5 to 24 in steps of 0.5.",
  text: "Comments can be at most 1000 characters.",
};

/** The message for a refused request; `field` messages are overridden by the caller's own wording where the form differs. */
export function refusal(failure: ApiFailure, own: Record<string, string> = {}, itemName?: string): string {
  const { error, field } = failure.body as { error?: string; field?: string; message?: string; item?: Item; by?: string; path?: string[] };
  if (error === "storage_unavailable") return STORAGE_OUTAGE;
  if (failure.status === 0 || failure.status >= 500) return SAVE_FAILED;
  switch (error) {
    case "read_only":
      return READ_ONLY;
    case "version_conflict": {
      const { by, item } = failure.body as { by: string; item: Item };
      return `${by} changed ${itemName ?? item.name} first. Your change was not saved.`;
    }
    case "invalid_field":
      return own[field ?? ""] ?? FIELD_MESSAGES[field ?? ""] ?? SAVE_FAILED;
    case "has_assignees":
      return "Remove the assignees before making this a milestone.";
    case "invalid_predecessors":
    case "loop":
      return String(failure.body.message);
    case "duplicate_link":
      return "Those tasks are already linked.";
    case "self_link":
      return "A task cannot wait for itself.";
    case "group_link":
      return "Groups cannot be linked.";
    case "invalid_link":
      return field === "lag" ? "Lag must be between -30 and 30 working days." : own[field ?? ""] ?? SAVE_FAILED;
    case "weekend":
      return "That date is a weekend.";
    case "duplicate_holiday":
      return "That date is already a holiday.";
    case "already_assigned":
      return own.already_assigned ?? SAVE_FAILED;
    default:
      return SAVE_FAILED;
  }
}

const countOfMoved = (moved: readonly Moved[]): string =>
  moved.length === 0 ? "No dependent tasks moved." : moved.length === 1 ? "1 dependent task moved." : `${moved.length} dependent tasks moved.`;

/** The sentence tail after a move, resize, link, predecessors save or delete: the moved count and the finish. */
function tail(moved: readonly Moved[], finish: IsoDate | null): string {
  return `${countOfMoved(moved)} Project finishes ${formatLong(finish ?? "")}.`;
}

interface Result {
  item: Item;
  moved: Moved[];
  finish: IsoDate | null;
}

export function moveSentence(result: Result, constrainedBy: string | null): string {
  const { item } = result;
  const start = formatLong(item.start ?? "");
  if (constrainedBy) return `${item.name} can start no earlier than ${start} because of ${constrainedBy}. ${tail(result.moved, result.finish)}`;
  const first = item.kind === "milestone" ? `${item.name} is now on ${start}.` : `${item.name} now starts ${start} and ends ${formatLong(item.end ?? "")}.`;
  return `${first} ${tail(result.moved, result.finish)}`;
}

export function resizeSentence(result: Result): string {
  const { item } = result;
  return `${item.name} now lasts ${workingDays(item.duration)} and ends ${formatLong(item.end ?? "")}. ${tail(result.moved, result.finish)}`;
}

export const percentSentence = (item: Item): string => `${item.name} is ${item.percent}% complete.`;
export const savedSentence = (item: Item): string => `${item.name} saved.`;
export const addedRowSentence = (item: Item): string => `${item.name} added as row ${item.row}.`;
export const minimumDuration = (item: Item): string => `${item.name} is already 1 working day long.`;
export const linkSentence = (from: string, to: string, type: LinkType, lag: number, result: Result): string =>
  `Linked ${from} to ${to}, ${LINK_TYPE_WORDS[type]}, lag ${lag}. ${tail(result.moved, result.finish)}`;
export const predecessorsSentence = (result: Result, canonical: string): string =>
  `${canonical ? `Predecessors of ${result.item.name} set to ${canonical}.` : `Predecessors of ${result.item.name} cleared.`} ${tail(result.moved, result.finish)}`;

export function deletedSentence(name: string, result: { moved: Moved[]; finish: IsoDate | null }): string {
  return result.finish === null ? `${name} deleted. The project has no tasks left.` : `${name} deleted. ${tail(result.moved, result.finish)}`;
}

export const movedRowSentence = (item: Item): string => `${item.name} moved to row ${item.row}.`;
export const groupedSentence = (item: Item, group: string | null): string =>
  group ? `${item.name} is now in ${group}.` : `${item.name} is no longer in a group.`;

function tasksMoved(count: number): string {
  return count === 0 ? "No tasks moved." : count === 1 ? "1 task moved." : `${count} tasks moved.`;
}

export function holidaySentence(verb: "added" | "removed", name: string, result: { moved: Moved[]; finish: IsoDate | null }): string {
  const lead = `Holiday ${name} ${verb}. ${tasksMoved(result.moved.length)}`;
  return result.finish === null ? lead : `${lead} Project finishes ${formatLong(result.finish)}.`;
}

export const baselineSentence = (name: string): string => `Baseline ${name} saved.`;
export const assignedSentence = (person: string, item: string, hours: number): string => `${person} assigned to ${item}, ${hours} hours a day.`;
export const unassignedSentence = (person: string, item: string): string => `${person} removed from ${item}.`;

export function updateSentence(kind: string, actor: string, itemName: string | null): string {
  switch (kind) {
    case "add":
      return `${actor} added ${itemName}.`;
    case "delete":
      return `${actor} deleted ${itemName}.`;
    case "holidays":
      return `${actor} changed the holidays.`;
    case "baseline":
      return `${actor} saved the baseline.`;
    case "comment":
      return `${actor} commented on ${itemName}.`;
    default:
      return `${actor} changed ${itemName}.`;
  }
}
