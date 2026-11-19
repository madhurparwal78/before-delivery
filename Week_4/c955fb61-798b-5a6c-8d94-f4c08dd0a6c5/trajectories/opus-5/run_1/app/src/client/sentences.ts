import { longDate } from '../shared/dates.js';
import { TYPE_WORDS, movedCountText, tasksMovedText, varianceText, workingDaysText } from '../shared/copy.js';
import type { Item, Link, LinkType, Project } from '../shared/types.js';

function tail(movedCount: number, finish: string | null): string {
  return ` ${movedCountText(movedCount)}${finish ? ` Project finishes ${longDate(finish)}.` : ''}`;
}

export function moveSentence(item: Item, movedCount: number, finish: string | null): string {
  const head =
    item.kind === 'milestone'
      ? `${item.name} is now on ${longDate(item.start!)}.`
      : `${item.name} now starts ${longDate(item.start!)} and ends ${longDate(item.end!)}.`;
  return head + tail(movedCount, finish);
}

export function resizeSentence(item: Item, movedCount: number, finish: string | null): string {
  return (
    `${item.name} now lasts ${workingDaysText(item.duration)} and ends ${longDate(item.end!)}.` +
    tail(movedCount, finish)
  );
}

export function linkSentence(
  from: string,
  to: string,
  type: LinkType,
  lag: number,
  movedCount: number,
  finish: string | null,
): string {
  return `Linked ${from} to ${to}, ${TYPE_WORDS[type]}, lag ${lag}.` + tail(movedCount, finish);
}

export function predecessorsSentence(
  name: string,
  canonical: string,
  movedCount: number,
  finish: string | null,
): string {
  const head = canonical === '' ? `Predecessors of ${name} cleared.` : `Predecessors of ${name} set to ${canonical}.`;
  return head + tail(movedCount, finish);
}

export function deleteSentence(
  name: string,
  movedCount: number,
  finish: string | null,
  emptyNow: boolean,
): string {
  if (emptyNow) return `${name} deleted. The project has no tasks left.`;
  return `${name} deleted.` + tail(movedCount, finish);
}

export function percentSentence(item: Item): string {
  return `${item.name} is ${item.percent}% complete.`;
}

export function constraintSentence(name: string, start: string, predecessor: string): string {
  return `${name} can start no earlier than ${longDate(start)} because of ${predecessor}.`;
}

export function savedSentence(name: string): string {
  return `${name} saved.`;
}

export function addedSentence(name: string, row: number): string {
  return `${name} added as row ${row}.`;
}

export function movedToRowSentence(name: string, row: number): string {
  return `${name} moved to row ${row}.`;
}

export function nowInGroupSentence(name: string, group: string): string {
  return `${name} is now in ${group}.`;
}

export function noLongerInGroupSentence(name: string): string {
  return `${name} is no longer in a group.`;
}

export function holidaySentence(
  name: string,
  added: boolean,
  movedCount: number,
  finish: string | null,
): string {
  const head = `Holiday ${name} ${added ? 'added' : 'removed'}. ${tasksMovedText(movedCount)}`;
  return finish ? `${head} Project finishes ${longDate(finish)}.` : head;
}

export function baselineSentence(name: string): string {
  return `Baseline ${name} saved.`;
}

export function assignedSentence(name: string, item: string, hours: string): string {
  return `${name} assigned to ${item}, ${hours} hours a day.`;
}

export function unassignedSentence(name: string, item: string): string {
  return `${name} removed from ${item}.`;
}

export function minimumDurationSentence(name: string): string {
  return `${name} is already 1 working day long.`;
}

export function finishText(finish: string | null): string {
  return finish ? `Finishes ${longDate(finish)}` : 'No finish date yet';
}

/** The bar description, linked through aria-describedby. */
export function barDescription(item: Item, project: Project): string {
  const parts: string[] = [];
  if (item.kind === 'task') parts.push(`Starts ${longDate(item.start!)}, ends ${longDate(item.end!)}`);
  else if (item.kind === 'milestone') parts.push(`Milestone on ${longDate(item.start!)}`);
  else parts.push(`Group from ${longDate(item.start!)} to ${longDate(item.end!)}`);

  if (item.kind === 'task') parts.push(`${workingDaysText(item.duration)}, ${item.percent}% complete`);
  else if (item.kind === 'milestone') parts.push(item.percent === 100 ? 'Done' : 'Not done');
  else parts.push(`${item.percent}% complete`);

  if (item.critical) parts.push('Critical');
  if (item.late) parts.push('Late');
  if (item.kind !== 'group' && item.baseline) parts.push(varianceText(item.baseline.variance));

  const rowOf = new Map(project.items.map((entry) => [entry.id, entry.row]));
  const nameOf = new Map(project.items.map((entry) => [entry.id, entry.name]));
  const incoming: Link[] = project.links
    .filter((link) => link.to === item.id)
    .sort((a, b) => (rowOf.get(a.from) ?? 0) - (rowOf.get(b.from) ?? 0));
  for (const link of incoming) {
    parts.push(`Waits for ${nameOf.get(link.from)}, ${TYPE_WORDS[link.type]}, lag ${link.lag}`);
  }

  return `${parts.join('. ')}.`;
}
