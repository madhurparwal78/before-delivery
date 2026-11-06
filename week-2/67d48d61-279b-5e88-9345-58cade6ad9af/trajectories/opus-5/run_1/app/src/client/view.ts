import { ui } from '../shared/copy.js';
import {
  COLUMN_STATUSES,
  CREW,
  CYCLE_KEYS,
  CYCLE_NAMES,
  DEPARTMENTS,
  PRIORITY_RANK,
  STATUS_GROUP_ORDER,
  STATUS_NAMES,
  type Status,
} from '../shared/domain.js';
import type { Task } from '../shared/types.js';
import type { State } from './store.js';

export interface Group {
  key: string;
  name: string;
  tasks: Task[];
}

export function isListed(task: Task): boolean {
  return task.status !== 'triage' && task.status !== 'duplicate';
}

export function triageTasks(state: State): Task[] {
  return [...state.tasks.values()]
    .filter((task) => task.status === 'triage')
    .sort((a, b) => a.number - b.number);
}

/** Every task the toolbar filters leave in view. */
export function filteredTasks(state: State): Task[] {
  const { address } = state;
  return [...state.tasks.values()].filter((task) => {
    if (!isListed(task)) return false;
    if (address.view === 'board' && task.status === 'cancelled') return false;
    if (address.dept !== null && task.department !== address.dept) return false;
    if (address.cycle !== null && task.cycle !== address.cycle) return false;
    if (address.blocked && !task.blocked) return false;
    return true;
  });
}

function byPriorityThenNumber(a: Task, b: Task): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.number - b.number;
}

export function groupsFor(state: State): Group[] {
  const tasks = filteredTasks(state);
  if (state.address.view === 'board') {
    return COLUMN_STATUSES.map((status) => ({
      key: status,
      name: STATUS_NAMES[status],
      tasks: tasks.filter((task) => task.status === status).sort(byPriorityThenNumber),
    }));
  }

  const groups: Group[] = [];
  const push = (key: string, name: string, member: (task: Task) => boolean): void => {
    const members = tasks.filter(member).sort(byPriorityThenNumber);
    if (members.length > 0) groups.push({ key, name, tasks: members });
  };

  switch (state.address.group) {
    case 'status':
      for (const status of STATUS_GROUP_ORDER) {
        push(status, STATUS_NAMES[status as Status], (task) => task.status === status);
      }
      break;
    case 'cycle':
      for (const cycle of CYCLE_KEYS) {
        push(cycle, CYCLE_NAMES[cycle], (task) => task.cycle === cycle);
      }
      push('none', ui.noCycleGroup, (task) => task.cycle === null);
      break;
    case 'department':
      for (const department of DEPARTMENTS) {
        push(department.key, department.name, (task) => task.department === department.key);
      }
      break;
    case 'owner':
      for (const member of CREW) {
        push(member.handle, member.name, (task) => task.owner === member.handle);
      }
      push('none', ui.noOwnerGroup, (task) => task.owner === null);
      break;
  }
  return groups;
}

export function orderedIds(state: State): string[] {
  return groupsFor(state).flatMap((group) => group.tasks.map((task) => task.id));
}
