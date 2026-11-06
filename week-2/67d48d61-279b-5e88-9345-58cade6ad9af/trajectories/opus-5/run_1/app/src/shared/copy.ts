import {
  CYCLE_NAMES,
  PRIORITY_NAMES,
  STATUS_NAMES,
  type CycleKey,
  type Priority,
  type Status,
} from './domain.js';

/** "1 task" when the number is 1, "<n> tasks" otherwise. */
export function taskCount(n: number): string {
  return n === 1 ? '1 task' : `${n} tasks`;
}

export const statusName = (status: Status): string => STATUS_NAMES[status];
export const priorityName = (priority: Priority): string => PRIORITY_NAMES[priority];
export const cycleName = (cycle: CycleKey): string => CYCLE_NAMES[cycle];

export const notice = {
  statusSingle(
    id: string,
    status: Status,
    closedParents: string[],
    reopenedParents: string[],
    freed: number,
  ): string {
    let text = `${id} moved to ${statusName(status)}.`;
    for (const parent of closedParents) text += ` ${parent} closed.`;
    for (const parent of reopenedParents) text += ` ${parent} reopened.`;
    if (freed > 0) text += ` ${taskCount(freed)} freed.`;
    return text;
  },
  prioritySingle: (id: string, priority: Priority): string =>
    `${id} priority set to ${priorityName(priority)}.`,
  ownerSingle: (id: string, name: string | null): string =>
    name === null ? `${id} unassigned.` : `${id} assigned to ${name}.`,
  updatedSingle: (id: string): string => `${id} updated.`,
  statusBulk(n: number, status: Status, freed: number): string {
    let text = `${taskCount(n)} moved to ${statusName(status)}.`;
    if (freed > 0) text += ` ${taskCount(freed)} freed.`;
    return text;
  },
  priorityBulk: (n: number, priority: Priority): string =>
    `Priority set to ${priorityName(priority)} on ${taskCount(n)}.`,
  ownerBulk: (n: number, name: string | null): string =>
    name === null ? `${taskCount(n)} unassigned.` : `${taskCount(n)} assigned to ${name}.`,
  undo(restored: number, reblocked: number): string {
    let text = `Undo restored ${taskCount(restored)}.`;
    if (reblocked > 0) text += ` ${taskCount(reblocked)} blocked again.`;
    return text;
  },
  created: (id: string): string => `${id} created.`,
  linkAdded: (blocker: string, blocked: string): string => `${blocker} now blocks ${blocked}.`,
  linkRemoved: (blocker: string, blocked: string): string =>
    `${blocker} no longer blocks ${blocked}.`,
  accepted: (id: string, cycle: CycleKey): string => `${id} accepted into ${cycleName(cycle)}.`,
  declined: (id: string): string => `${id} declined.`,
  merged: (id: string, target: string): string => `${id} merged into ${target}.`,
  triageClear: ' Triage is clear.',
  uploaded: (fileName: string, id: string): string => `${fileName} attached to ${id}.`,
  requestFiled: 'Request filed. It reaches triage within a few seconds.',
};

export const rejection = {
  versionSingle: (id: string): string =>
    `${id} was changed by someone else. Showing the saved version.`,
  versionBulk:
    'No tasks changed: some were edited by someone else. Showing the saved versions.',
  bulkRefused: (k: number): string =>
    `No tasks changed. ${k} of the selected tasks can't take that change.`,
  illegalMove: (id: string, from: Status, to: Status): string =>
    `${id} can't move from ${statusName(from)} to ${statusName(to)}.`,
  blockedToDone: (id: string, ids: string[]): string =>
    `${id} is still blocked by ${ids.join(', ')}.`,
  openSubtasks: (id: string): string => `${id} has open sub-tasks.`,
  notEditable: (id: string, status: Status): string =>
    `${id} can't be edited in ${statusName(status)}.`,
  linkCycle: 'That link would make a loop, so it was not added.',
  linkOther: "That link can't be added.",
  nothingToUndo: 'Nothing to undo.',
  undoStale: 'Undo stopped: a task changed after that edit.',
  intakeUnreachable: (id: string): string =>
    `Request intake is unreachable, so ${id} stays in triage.`,
  intakeRefused: (id: string): string =>
    `Request intake refused the decision, so ${id} stays in triage.`,
  alreadyDecided: (id: string): string => `${id} was already decided.`,
  storageUnreachable: (fileName: string): string =>
    `Plot storage is unreachable. ${fileName} was not attached.`,
  uploadInterrupted: (fileName: string): string => `${fileName} was not attached.`,
  network: "Couldn't reach Promptside. Nothing was saved.",
};

export const fieldMessage = {
  titleEmpty: 'Give the task a title.',
  titleLong: 'Keep it to 140 characters.',
  details: 'Keep details to 4,000 characters.',
  department: 'Choose a department.',
  priority: 'Choose a priority from 0 to 4.',
  owner: 'Choose someone on the crew list.',
  crewMember: 'Choose someone on the crew list.',
  status: 'Choose a status.',
  label: 'Choose a label this department uses.',
  cycle: 'Choose the current cycle or a later one.',
  parent: 'Choose an existing task that is not a sub-task.',
  blocksSelf: "A task can't block itself.",
  blocksUnknown: 'Choose an existing task.',
  tasks: 'Choose 1 to 100 tasks.',
  set: 'Choose a change to make.',
  decision: 'Choose accept, decline or merge.',
  reason: 'Say why it was declined.',
  duplicateOf: 'Choose an accepted task to merge into.',
  requestTitleEmpty: 'Say what you need.',
  requestTitleLong: 'Keep it to 140 characters.',
  requester: 'Add your name.',
  file: 'Attach a PDF, PNG or JPEG file.',
  kind: 'Choose sketch, plot or rendering.',
  idempotencyKey: 'Use 1 to 100 visible characters.',
  queryFilter: "That filter value isn't recognised.",
};

export const ui = {
  triageEmptyHeading: 'Triage is clear',
  triageEmptyLine: 'Every request from the rehearsal room has an answer.',
  tasksEmptyHeading: 'No tasks match this view',
  requestsEmpty: 'No requests filed yet.',
  attachmentsEmpty: 'No attachments yet.',
  notFoundHeading: "This page isn't in the prompt book",
  backToTasks: 'Back to tasks',
  intakeDown:
    'Request intake is unreachable. New requests reach triage when it is back, and decisions are paused.',
  storageDown:
    "Plot storage is unreachable. Attachments can't be uploaded or opened right now; everything else still works.",
  requestsIntakeDown: "Request outcomes can't be shown until the intake is back.",
  noOwnerGroup: 'No owner',
  noCycleGroup: 'No cycle',
  awaitingTriage: 'Awaiting triage',
  blockedChip: 'Blocked',
  saving: 'Saving',
  sendingToIntake: 'Sending to intake',
  filing: 'Filing',
  errorSummaryHeading: 'There is a problem',
  freedBadge: (id: string): string => `Freed by ${id}`,
  rollUp: (done: number, total: number): string => `${done} of ${total} sub-tasks done`,
  cycleProgress: (done: number, total: number): string => `${done} of ${total} done`,
  uploading: (fileName: string): string => `Uploading ${fileName}`,
  countdown(days: number): string {
    if (days > 1) return `${days} days to opening`;
    if (days === 1) return '1 day to opening';
    if (days === 0) return 'Opening tonight';
    return 'Now running';
  },
};
