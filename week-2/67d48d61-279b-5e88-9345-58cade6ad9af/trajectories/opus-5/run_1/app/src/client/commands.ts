import {
  CREW,
  DEPARTMENTS,
  PRIORITIES,
  PRIORITY_NAMES,
  STATUS_NAMES,
  type DepartmentKey,
  type Priority,
  type Status,
} from '../shared/domain.js';
import { bulkSet, undoLast } from './actions.js';
import { go, navigateTo } from './navigation.js';
import { getState, setState } from './store.js';

export interface Command {
  label: string;
  run: (targets: string[]) => void;
}

const MOVABLE: Status[] = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'];

export function commandList(): Command[] {
  const commands: Command[] = [];
  for (const member of CREW) {
    commands.push({
      label: `Assign to ${member.name}`,
      run: (targets) => void bulkSet(targets, { owner: member.handle }),
    });
  }
  commands.push({ label: 'Unassign', run: (targets) => void bulkSet(targets, { owner: null }) });
  for (const priority of PRIORITIES) {
    commands.push({
      label: `Set priority: ${PRIORITY_NAMES[priority]}`,
      run: (targets) => void bulkSet(targets, { priority: priority as Priority }),
    });
  }
  for (const status of MOVABLE) {
    commands.push({
      label: `Move to ${STATUS_NAMES[status]}`,
      run: (targets) => void bulkSet(targets, { status }),
    });
  }
  commands.push({ label: 'Undo last change', run: () => void undoLast() });
  commands.push({
    label: 'New task',
    run: () => setState({ dialog: { kind: 'new-task', parent: null } }),
  });
  commands.push({ label: 'File a request', run: () => setState({ dialog: { kind: 'file-request' } }) });
  commands.push({ label: 'Go to All tasks', run: () => navigateTo('/tasks', { dept: null }) });
  commands.push({ label: 'Go to Triage', run: () => navigateTo('/triage') });
  commands.push({ label: 'Go to Requests', run: () => navigateTo('/requests') });
  for (const department of DEPARTMENTS) {
    commands.push({
      label: `Go to ${department.name}`,
      run: () => navigateTo('/tasks', { dept: department.key as DepartmentKey }),
    });
  }
  commands.push({ label: 'Group by Status', run: () => go({ group: 'status' }) });
  commands.push({ label: 'Group by Cycle', run: () => go({ group: 'cycle' }) });
  commands.push({ label: 'Group by Department', run: () => go({ group: 'department' }) });
  commands.push({ label: 'Group by Owner', run: () => go({ group: 'owner' }) });
  commands.push({ label: 'Show blocked only', run: () => go({ blocked: true }) });
  commands.push({ label: 'Show all', run: () => go({ blocked: false }) });
  commands.push({ label: 'List view', run: () => go({ view: 'list' }) });
  commands.push({ label: 'Board view', run: () => go({ view: 'board' }) });
  return commands;
}

/** Task commands apply to the selection, or to the current row when nothing is selected. */
export function commandTargets(): string[] {
  const state = getState();
  if (state.selection.length > 0) return state.selection;
  return state.current === null ? [] : [state.current];
}

export function matchingCommands(text: string): Command[] {
  const needle = text.trim().toLowerCase();
  const all = commandList();
  if (needle.length === 0) return all;
  return all.filter((command) => command.label.toLowerCase().includes(needle));
}
