import { useEffect, useRef, useState } from 'react';
import type { Task, TaskLists, TaskType } from '../../shared/types.js';
import { gold2 } from '../../shared/format.js';
import { buyReward, checkItem, completeTask, moveTask, scoreTask, uncompleteTask } from '../store.js';

export type ListKey = 'habits' | 'dailies' | 'todos' | 'rewards';

export const LIST_ORDER: ListKey[] = ['habits', 'dailies', 'todos', 'rewards'];

export const LIST_TITLES: Record<ListKey, string> = {
  habits: 'Habits',
  dailies: 'Dailies',
  todos: 'To-dos',
  rewards: 'Rewards',
};

export const LIST_TYPES: Record<ListKey, TaskType> = {
  habits: 'habit',
  dailies: 'daily',
  todos: 'todo',
  rewards: 'reward',
};

const ADD_LABELS: Record<ListKey, string> = {
  habits: 'Add habit',
  dailies: 'Add daily',
  todos: 'Add to-do',
  rewards: 'Add reward',
};

const EMPTY_WORDS: Record<ListKey, string> = {
  habits: 'FRESH',
  dailies: 'OPEN',
  todos: 'CLEAR',
  rewards: 'TREAT',
};

const EMPTY_LINES: Record<ListKey, string> = {
  habits: 'No habits yet. Add one to start scoring.',
  dailies: 'No dailies yet. Pick the days that matter.',
  todos: 'No to-dos. Add one, or enjoy the quiet.',
  rewards: 'No rewards yet. Name a treat worth the gold.',
};

export function rowName(task: Task): string {
  if (task.type === 'habit') return `Habit: ${task.title}, score ${task.value}`;
  if (task.type === 'daily') {
    const due = task.dueToday ? 'due today' : 'not due today';
    const done = task.done ? 'done' : 'not done';
    return `Daily: ${task.title}, ${due}, streak ${task.streak}, ${done}`;
  }
  if (task.type === 'todo') {
    const items = task.checklist ?? [];
    const done = task.done ? 'done' : 'not done';
    if (items.length === 0) return `To-do: ${task.title}, ${done}`;
    const checked = items.filter((item) => item.checked).length;
    return `To-do: ${task.title}, ${checked} of ${items.length} checklist items, ${done}`;
  }
  return `Reward: ${task.title}, costs ${gold2(task.price ?? 0)} gold`;
}

function isTextEntry(element: EventTarget | null): boolean {
  if (element instanceof HTMLInputElement) return element.type !== 'checkbox';
  if (!(element instanceof HTMLElement)) return false;
  return element.tagName === 'TEXTAREA' || element.tagName === 'SELECT';
}

function isRowControl(element: EventTarget | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.tagName === 'BUTTON' || element instanceof HTMLInputElement;
}

export type FocusRequest = { kind: 'task'; id: string } | { kind: 'place'; list: ListKey; index: number };

interface BoardProps {
  tasks: TaskLists;
  visibleLists: ListKey[];
  focusRequest: FocusRequest | null;
  onFocusHandled: () => void;
  onNewTask: (type: TaskType, opener: HTMLElement | null) => void;
  onEditTask: (task: Task, opener: HTMLElement | null) => void;
}

const SWIPE_DISTANCE = 80;

export function Board({
  tasks,
  visibleLists,
  focusRequest,
  onFocusHandled,
  onNewTask,
  onEditTask,
}: BoardProps): JSX.Element {
  const [active, setActive] = useState<Record<ListKey, number>>({
    habits: 0,
    dailies: 0,
    todos: 0,
    rewards: 0,
  });
  const [wanted, setWanted] = useState<{ list: ListKey; taskId: string | null } | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const listNodes = useRef(new Map<ListKey, HTMLUListElement>());

  useEffect(() => {
    if (!wanted) return;
    const node = wanted.taskId === null ? undefined : rows.current.get(wanted.taskId);
    if (node) node.focus();
    else listNodes.current.get(wanted.list)?.focus();
    setWanted(null);
  }, [wanted, tasks]);

  const listOf = (key: ListKey): Task[] => tasks[key];

  const moveFocus = (key: ListKey, index: number): void => {
    setActive((current) => ({ ...current, [key]: index }));
    setWanted({ list: key, taskId: tasks[key][index]?.id ?? null });
  };

  /** Keeps focus on one task while its place in the list changes. */
  const holdFocusOn = (key: ListKey, index: number, taskId: string): void => {
    setActive((current) => ({ ...current, [key]: index }));
    setWanted({ list: key, taskId });
  };

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.kind === 'task') {
      for (const key of LIST_ORDER) {
        const index = tasks[key].findIndex((task) => task.id === focusRequest.id);
        if (index >= 0) {
          moveFocus(key, index);
          break;
        }
      }
    } else {
      const length = tasks[focusRequest.list].length;
      if (length === 0) setWanted({ list: focusRequest.list, taskId: null });
      else moveFocus(focusRequest.list, Math.min(focusRequest.index, length - 1));
    }
    onFocusHandled();
  }, [focusRequest, tasks, onFocusHandled]);

  const crossTo = (key: ListKey, step: number, index: number): void => {
    const order = visibleLists;
    const place = order.indexOf(key);
    const target = order[place + step];
    if (target === undefined) return;
    const length = listOf(target).length;
    if (length === 0) {
      setWanted({ list: target, taskId: null });
      return;
    }
    moveFocus(target, Math.min(index, length - 1));
  };

  const onKeyDown = (key: ListKey) => (event: React.KeyboardEvent<HTMLUListElement>): void => {
    if (isTextEntry(event.target)) return;
    // A row's own control keeps Enter and Space for itself.
    if ((event.key === 'Enter' || event.key === ' ') && isRowControl(event.target)) return;
    const items = listOf(key);
    const index = Math.min(active[key], Math.max(0, items.length - 1));
    const task = items[index];

    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      onNewTask(LIST_TYPES[key], event.target instanceof HTMLElement ? event.target : null);
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      if (!task) return;
      const next = event.key === 'ArrowUp' ? index - 1 : index + 1;
      if (next < 0 || next >= items.length) return;
      holdFocusOn(key, next, task.id);
      void moveTask(task, next + 1, items.length).then(() => holdFocusOn(key, next, task.id));
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (index + 1 < items.length) moveFocus(key, index + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index > 0) moveFocus(key, index - 1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      crossTo(key, 1, index);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      crossTo(key, -1, index);
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (!task) return;
      const row = rows.current.get(task.id) ?? null;
      if (task.type === 'reward') {
        void buyReward(task).then(() => row?.focus());
        return;
      }
      if (task.type !== 'daily' && task.type !== 'todo') return;
      if (task.done) void uncompleteTask(task);
      else void completeTask(task, row);
      return;
    }
    if (event.key === '+' || event.key === '-') {
      event.preventDefault();
      if (!task || task.type !== 'habit') return;
      const row = rows.current.get(task.id) ?? null;
      void scoreTask(task, event.key === '+' ? 'up' : 'down', row);
      return;
    }
    if (event.key === 'Enter') {
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      if (!task) return;
      onEditTask(task, rows.current.get(task.id) ?? null);
    }
  };

  const renderRow = (key: ListKey, task: Task, index: number): JSX.Element => {
    const focusable = index === Math.min(active[key], Math.max(0, listOf(key).length - 1));
    return (
      <li
        key={task.id}
        aria-label={rowName(task)}
        tabIndex={focusable ? 0 : -1}
        className={`row row-${task.type}${task.done ? ' row-done' : ''}`}
        ref={(element) => {
          if (element) rows.current.set(task.id, element);
          else rows.current.delete(task.id);
        }}
        onFocus={() => setActive((current) => ({ ...current, [key]: index }))}
        {...swipeHandlers(task, () => rows.current.get(task.id) ?? null)}
      >
        {rowControls(task, () => rows.current.get(task.id) ?? null, onEditTask)}
      </li>
    );
  };

  return (
    <>
      {visibleLists.map((key) => {
        const items = listOf(key);
        return (
          <section className={`list-field field-${key}`} key={key}>
            <header className="list-head">
              <h2 className="list-title">{LIST_TITLES[key]}</h2>
              <button
                type="button"
                className="add-button"
                onClick={(event) => onNewTask(LIST_TYPES[key], event.currentTarget)}
              >
                {ADD_LABELS[key]}
              </button>
            </header>
            {items.length === 0 ? (
              <div className="empty-state">
                <span className="empty-word" aria-hidden="true">
                  {EMPTY_WORDS[key]}
                </span>
                <p className="empty-line">{EMPTY_LINES[key]}</p>
                <ul
                  className="list"
                  role="list"
                  aria-label={LIST_TITLES[key]}
                  data-list={key}
                  tabIndex={0}
                  onKeyDown={onKeyDown(key)}
                  ref={(element) => {
                    if (element) listNodes.current.set(key, element);
                  }}
                />
              </div>
            ) : (
              <ul
                className="list"
                role="list"
                aria-label={LIST_TITLES[key]}
                data-list={key}
                onKeyDown={onKeyDown(key)}
                ref={(element) => {
                  if (element) listNodes.current.set(key, element);
                }}
              >
                {items.map((task, index) => renderRow(key, task, index))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

const swipe = { startX: 0, shift: 0 };

function swipeHandlers(
  task: Task,
  row: () => HTMLLIElement | null,
): {
  onTouchStart?: (event: React.TouchEvent<HTMLLIElement>) => void;
  onTouchMove?: (event: React.TouchEvent<HTMLLIElement>) => void;
  onTouchEnd?: (event: React.TouchEvent<HTMLLIElement>) => void;
} {
  if (task.type !== 'daily' && task.type !== 'todo') return {};
  return {
    onTouchStart: (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      swipe.startX = touch.clientX;
      swipe.shift = 0;
    },
    onTouchMove: (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      swipe.shift = touch.clientX - swipe.startX;
      const node = row();
      if (node) node.style.transform = `translateX(${Math.max(0, swipe.shift)}px)`;
    },
    onTouchEnd: () => {
      const node = row();
      if (node) node.style.transform = 'translateX(0)';
      if (swipe.shift >= SWIPE_DISTANCE && !task.done) void completeTask(task, node);
      swipe.shift = 0;
    },
  };
}

function rowControls(
  task: Task,
  row: () => HTMLLIElement | null,
  onEditTask: (task: Task, opener: HTMLElement | null) => void,
): JSX.Element {
  const title = (
    <button type="button" className="row-title" tabIndex={-1} onClick={() => onEditTask(task, row())}>
      {task.title}
    </button>
  );

  if (task.type === 'habit') {
    return (
      <>
        <div className="row-main">{title}</div>
        <div className="row-meta">
          <span className="chip">{task.band}</span>
          <span className="row-score tabular">{task.value}</span>
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="circle"
            tabIndex={-1}
            aria-label={`Score ${task.title} up`}
            onClick={() => void scoreTask(task, 'up', row())}
          >
            +
          </button>
          <button
            type="button"
            className="circle"
            tabIndex={-1}
            aria-label={`Score ${task.title} down`}
            onClick={() => void scoreTask(task, 'down', row())}
          >
            &minus;
          </button>
        </div>
      </>
    );
  }

  if (task.type === 'reward') {
    return (
      <>
        <div className="row-main">
          {title}
          <span className="row-price tabular">{`${gold2(task.price ?? 0)} gold`}</span>
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="buy-button"
            tabIndex={-1}
            aria-label={`Buy ${task.title}`}
            onClick={() => {
              const node = row();
              void buyReward(task).then(() => node?.focus());
            }}
          >
            Buy
          </button>
        </div>
      </>
    );
  }

  const items = task.checklist ?? [];
  return (
    <>
      <div className="row-main">
        <input
          type="checkbox"
          className="circle-check"
          tabIndex={-1}
          aria-label={`Complete ${task.title}`}
          checked={task.done === true}
          onChange={(event) => {
            if (event.currentTarget.checked) void completeTask(task, row());
            else void uncompleteTask(task);
          }}
        />
        {title}
      </div>
      <div className="row-meta">
        <span className="chip">{task.band}</span>
        {task.type === 'daily' ? <span className="row-streak tabular">{`streak ${task.streak}`}</span> : null}
      </div>
      {items.length > 0 ? (
        <ul className="checklist" role="list">
          {items.map((item) => (
            <li key={item.id}>
              <label className="checklist-item">
                <input
                  type="checkbox"
                  tabIndex={-1}
                  aria-label={item.text}
                  checked={item.checked}
                  onChange={(event) => void checkItem(task, item.id, event.currentTarget.checked)}
                />
                <span>{item.text}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
