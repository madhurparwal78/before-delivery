// Every announced and visible string the brief publishes, word for word.

import { PRIORITY_NAMES, STATUS_NAMES, crewByHandle, type StatusKey } from "../../shared/catalog";

const tasksWord = (n: number): string => `${n} task${n === 1 ? "" : "s"}`;

const freedTail = (k: number): string => (k ? ` ${tasksWord(k)} freed.` : "");

export const copy = {
  statusMoved: (id: string, status: StatusKey, closed: string[], reopened: string[], freed: number) =>
    `${id} moved to ${STATUS_NAMES[status]}.${closed.map((p) => ` ${p} closed.`).join("")}${reopened.map((p) => ` ${p} reopened.`).join("")}${freedTail(freed)}`,
  priority: (id: string, priority: number) => `${id} priority set to ${PRIORITY_NAMES[priority]}.`,
  owner: (id: string, owner: string | null) => (owner ? `${id} assigned to ${crewByHandle(owner)?.name}.` : `${id} unassigned.`),
  updated: (id: string) => `${id} updated.`,
  bulkStatus: (n: number, status: StatusKey, freed: number) => `${tasksWord(n)} moved to ${STATUS_NAMES[status]}.${freedTail(freed)}`,
  bulkPriority: (n: number, priority: number) => `Priority set to ${PRIORITY_NAMES[priority]} on ${tasksWord(n)}.`,
  bulkOwner: (n: number, owner: string | null) =>
    owner ? `${tasksWord(n)} assigned to ${crewByHandle(owner)?.name}.` : `${tasksWord(n)} unassigned.`,
  undo: (n: number, k: number) => `Undo restored ${tasksWord(n)}.${k ? ` ${tasksWord(k)} blocked again.` : ""}`,
  created: (id: string) => `${id} created.`,
  linked: (a: string, b: string) => `${a} now blocks ${b}.`,
  unlinked: (a: string, b: string) => `${a} no longer blocks ${b}.`,
  accepted: (id: string, cycle: string) => `${id} accepted into ${cycle}.`,
  declined: (id: string) => `${id} declined.`,
  merged: (id: string, into: string) => `${id} merged into ${into}.`,
  triageClear: " Triage is clear.",
  attached: (file: string, id: string) => `${file} attached to ${id}.`,
  filed: "Request filed. It reaches triage within a few seconds.",
  conflict: (id: string) => `${id} was changed by someone else. Showing the saved version.`,
  bulkConflict: "No tasks changed: some were edited by someone else. Showing the saved versions.",
  bulkRefused: (k: number) => `No tasks changed. ${k} of the selected tasks can't take that change.`,
  illegal: (id: string, from: StatusKey, to: StatusKey) => `${id} can't move from ${STATUS_NAMES[from]} to ${STATUS_NAMES[to]}.`,
  stillBlocked: (id: string, ids: string[]) => `${id} is still blocked by ${ids.join(", ")}.`,
  openSubtasks: (id: string) => `${id} has open sub-tasks.`,
  notEditable: (id: string, status: StatusKey) => `${id} can't be edited in ${STATUS_NAMES[status]}.`,
  loop: "That link would make a loop, so it was not added.",
  linkRefused: "That link can't be added.",
  nothingToUndo: "Nothing to undo.",
  undoStale: "Undo stopped: a task changed after that edit.",
  intakeUnreachable: (id: string) => `Request intake is unreachable, so ${id} stays in triage.`,
  intakeRefused: (id: string) => `Request intake refused the decision, so ${id} stays in triage.`,
  alreadyDecided: (id: string) => `${id} was already decided.`,
  storageDown: (file: string) => `Plot storage is unreachable. ${file} was not attached.`,
  notAttached: (file: string) => `${file} was not attached.`,
  offline: "Couldn't reach Promptside. Nothing was saved.",
  // Decided copy, where the brief gives none.
  filingRefused: "Request intake is unreachable, so the request was not filed.",
  unlinkRefused: "That link can't be removed.",
  parentHasBlockers: "A task with blockers can't take sub-tasks.",
  intakeBanner: "Request intake is unreachable. New requests reach triage when it is back, and decisions are paused.",
  storageBanner: "Plot storage is unreachable. Attachments can't be uploaded or opened right now; everything else still works.",
  outcomesUnavailable: "Request outcomes can't be shown until the intake is back.",
  countdown: (days: number) =>
    days >= 2 ? `${days} days to opening` : days === 1 ? "1 day to opening" : days === 0 ? "Opening tonight" : "Now running",
  rollup: (done: number, total: number) => `${done} of ${total} sub-tasks done`,
  cycleProgress: (done: number, total: number) => `${done} of ${total} done`,
  freedBy: (id: string) => `Freed by ${id}`,
  noTasks: "No tasks match this view",
  triageClearHeading: "Triage is clear",
  triageClearLine: "Every request from the rehearsal room has an answer.",
  noRequests: "No requests filed yet.",
  noAttachments: "No attachments yet.",
  awaitingTriage: "Awaiting triage",
  notFound: "This page isn't in the prompt book",
  problem: "There is a problem",
};

// Dates and times in the theatre's time zone.
export const stamp = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
