import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { api, MINUS, fmt1, fmtGold, type Task, type ActionResult, type Player, type TasksBody } from './api.js';
import { useStore } from './store.js';
import { TaskDialog, ImportDialog, LevelDialog, FaintDialog } from './dialogs.js';
import { PartyRail } from './partyrail.js';

type ListKey = 'habits' | 'dailies' | 'todos' | 'rewards';
const LIST_ORDER: ListKey[] = ['habits', 'dailies', 'todos', 'rewards'];
const LIST_TITLES: Record<ListKey, string> = {
  habits: 'Habits',
  dailies: 'Dailies',
  todos: 'To-dos',
  rewards: 'Rewards',
};
const ADD_LABELS: Record<ListKey, string> = {
  habits: 'Add habit',
  dailies: 'Add daily',
  todos: 'Add to-do',
  rewards: 'Add reward',
};
const EMPTY_WORDS: Record<ListKey, string> = { habits: 'FRESH', dailies: 'OPEN', todos: 'CLEAR', rewards: 'TREAT' };
const EMPTY_SENTENCES: Record<ListKey, string> = {
  habits: 'No habits yet. Add one to start scoring.',
  dailies: 'No dailies yet. Pick the days that matter.',
  todos: 'No to-dos. Add one, or enjoy the quiet.',
  rewards: 'No rewards yet. Name a treat worth the gold.',
};

interface BoardFocus {
  list: ListKey;
  index: number;
}

export function Board() {
  const store = useStore();
  const { tasks, player, feed } = store;
  const [focus, setFocus] = useState<BoardFocus>({ list: 'habits', index: 0 });
  const [lastIndex, setLastIndex] = useState<Record<ListKey, number>>({ habits: 0, dailies: 0, todos: 0, rewards: 0 });
  const [dialog, setDialog] = useState<
    | { kind: 'new'; type: ListKey }
    | { kind: 'edit'; task: Task }
    | { kind: 'import' }
    | { kind: 'levelup'; level: number; fromId?: string }
    | { kind: 'faint'; level: number; goldLost: number; fromId?: string }
    | null
  >(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [showParty, setShowParty] = useState(false);
  const [phoneList, setPhoneList] = useState<ListKey>('habits');
  const [strikedChip, setStrikedChip] = useState<{ id: string; damage: number } | null>(null);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const dialogReturnRef = useRef<HTMLElement | null>(null);
  const resultRef = useRef<ActionResult | null>(null);

  const listFor = (k: ListKey): Task[] => tasks[k] ?? [];

  const focusRow = (k: ListKey, i: number) => {
    const list = listFor(k);
    if (list.length === 0) return;
    const idx = Math.min(i, list.length - 1);
    setFocus({ list: k, index: idx });
    setLastIndex((prev) => ({ ...prev, [k]: idx }));
    const row = rowRefs.current.get(list[idx].id);
    row?.focus();
  };

  // Announce the result of an own action in the feed, then show dialogs.
  const announce = (result: ActionResult) => {
    resultRef.current = result;
    const t = result.task;
    if (t.type === 'habit') {
      if (result.delta.health < 0) {
        store.setFeed(`${t.title} scored down: you lost ${fmt1(Math.abs(result.delta.health))} health`);
      } else {
        store.setFeed(`${t.title} scored: +${result.delta.experience} experience, +${fmtGold(result.delta.gold)} gold`);
      }
    } else if (result.delta.experience > 0) {
      store.setFeed(`${t.title} complete: +${result.delta.experience} experience, +${fmtGold(result.delta.gold)} gold`);
    }
    if (result.strike && result.strike.kind === 'strike') {
      const ownSentence = `${t.title} scored: +${result.delta.experience} experience, +${fmtGold(result.delta.gold)} gold`;
      setTimeout(() => {
        store.setFeed(`${result.strike ? `Boss took ${result.strike.amount.toFixed(1)} damage` : ''}`);
      }, 400);
      void ownSentence;
    }
    if (result.levelUp) {
      setDialog({ kind: 'levelup', level: (result.player as Player).level, fromId: t.id });
    } else if (result.fainted) {
      const notice = result.player.notices.find((n) => n.kind === 'faint');
      setDialog({
        kind: 'faint',
        level: (result.player as Player).level,
        goldLost: notice?.goldLost ?? 0,
        fromId: t.id,
      });
    }
  };

  const doScore = async (t: Task, direction: 'up' | 'down') => {
    setError('');
    setPending((s) => new Set(s).add(t.id));
    try {
      const result = await api.score(t.id, direction);
      announce(result);
      if (result.strike) {
        setStrikedChip({ id: t.id, damage: result.strike.amount });
        setTimeout(() => setStrikedChip(null), 700);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
    }
  };

  const doCompleteToggle = async (t: Task) => {
    setError('');
    setPending((s) => new Set(s).add(t.id));
    try {
      if (t.done) {
        const result = await api.uncomplete(t.id);
        store.setFeed(`${t.title} undone`);
      } else {
        const result = await api.complete(t.id);
        announce(result);
        if (result.strike) {
          setStrikedChip({ id: t.id, damage: result.strike.amount });
          setTimeout(() => setStrikedChip(null), 700);
        }
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
    }
  };

  const doBuy = async (t: Task) => {
    setError('');
    setPending((s) => new Set(s).add(t.id));
    try {
      const result = await api.buy(t.id);
      store.setFeed(`${t.title} bought for ${fmtGold(Math.abs(result.delta.gold))} gold`);
      const row = rowRefs.current.get(t.id);
      row?.focus();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
    }
  };

  const doMove = async (k: ListKey, index: number, delta: -1 | 1) => {
    const list = listFor(k);
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const t = list[index];
    setError('');
    setPending((s) => new Set(s).add(t.id));
    try {
      await api.moveTask(t.id, target + 1);
      store.setFeed(`${t.title} moved to position ${target + 1} of ${list.length}`);
      requestAnimationFrame(() => focusRow(k, target));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
    }
  };

  // The keyboard model for the whole board.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (dialog) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && target.getAttribute('type') !== 'checkbox') return;
      if (target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
      if (target.classList.contains('spinbutton')) return;

      const { list, index } = focus;
      const listLen = listFor(list).length;
      const key = e.key;

      if (key === 'ArrowUp' || key === 'ArrowDown') {
        if (e.altKey) {
          e.preventDefault();
          void doMove(list, index, key === 'ArrowUp' ? -1 : 1);
        } else {
          e.preventDefault();
          const next = key === 'ArrowUp' ? Math.max(0, index - 1) : Math.min(listLen - 1, index + 1);
          focusRow(list, next);
        }
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        e.preventDefault();
        const pos = LIST_ORDER.indexOf(list);
        const nextPos = key === 'ArrowLeft' ? pos - 1 : pos + 1;
        if (nextPos < 0 || nextPos >= LIST_ORDER.length) return;
        const nextList = LIST_ORDER[nextPos];
        const nextLen = listFor(nextList).length;
        const atSame = Math.min(index, nextLen - 1);
        if (nextLen === 0) {
          setFocus({ list: nextList, index: 0 });
          setLastIndex((p) => ({ ...p, [nextList]: 0 }));
        } else {
          focusRow(nextList, Math.max(0, atSame));
        }
        return;
      }
      if (key === '+' || key === '=') {
        const t = listFor(list)[index];
        if (t && t.type === 'habit') {
          e.preventDefault();
          void doScore(t, 'up');
        }
        return;
      }
      if (key === '-') {
        const t = listFor(list)[index];
        if (t && t.type === 'habit') {
          e.preventDefault();
          void doScore(t, 'down');
        }
        return;
      }
      if (key === ' ') {
        const t = listFor(list)[index];
        if (t && (t.type === 'daily' || t.type === 'todo')) {
          e.preventDefault();
          void doCompleteToggle(t);
        }
        return;
      }
      if (key === 'Enter') {
        const t = listFor(list)[index];
        if (t) {
          e.preventDefault();
          dialogReturnRef.current = rowRefs.current.get(t.id) ?? null;
          setDialog({ kind: 'edit', task: t });
        }
        return;
      }
      if (key === 'n' || key === 'N') {
        e.preventDefault();
        dialogReturnRef.current = null;
        setDialog({ kind: 'new', type: list });
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focus, dialog, tasks]);

  const openNew = (k: ListKey, opener?: HTMLElement | null) => {
    dialogReturnRef.current = opener ?? null;
    setDialog({ kind: 'new', type: k });
  };

  const closeDialog = () => {
    setDialog(null);
    if (dialog?.kind === 'new' || dialog?.kind === 'edit') {
      dialogReturnRef.current?.focus();
    }
  };

  const afterCreate = (created: Task) => {
    setDialog(null);
    const k = created.type + 's' as ListKey;
    // The row renders once the store's tasks update; retry until it exists.
    let tries = 0;
    const tryFocus = () => {
      const row = rowRefs.current.get(created.id);
      if (row) {
        row.focus();
        return;
      }
      tries += 1;
      if (tries < 40) setTimeout(tryFocus, 50);
    };
    requestAnimationFrame(tryFocus);
  };

  const afterDelete = (deleted: Task) => {
    setDialog(null);
    const k = deleted.type + 's' as ListKey;
    requestAnimationFrame(() => {
      const len = listFor(k).length;
      if (len === 0) setFocus({ list: k, index: 0 });
      else focusRow(k, Math.min(focus.index, len - 1));
    });
  };

  return (
    <div className="board-wrap">
      <div className="alert-area">{error && <div className="alert-strip" role="alert">{error}</div>}</div>
      <p className="game-feed" role="status" aria-live="polite" aria-label="Game feed">{feed}</p>

      <div className="lists-tabs" role="tablist" aria-label="Lists">
        {LIST_ORDER.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={phoneList === k}
            className={`list-tab ${phoneList === k ? 'tab-active' : ''}`}
            onClick={() => {
              setPhoneList(k);
              focusRow(k, lastIndex[k]);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const pos = LIST_ORDER.indexOf(k);
                const next = e.key === 'ArrowLeft' ? pos - 1 : pos + 1;
                if (next >= 0 && next < LIST_ORDER.length) {
                  const nk = LIST_ORDER[next];
                  setPhoneList(nk);
                  focusRow(nk, lastIndex[nk]);
                }
              }
            }}
          >
            {LIST_TITLES[k]}
          </button>
        ))}
      </div>

      <button className="btn party-btn" type="button" onClick={() => setShowParty(true)}>Party</button>

      <div className="board-columns">
        {LIST_ORDER.slice(0, 3).map((k) => (
          <section
            key={k}
            className={`task-list list-${k} ${phoneList === k ? 'list-visible' : 'list-hidden'}`}
            aria-label={LIST_TITLES[k]}
          >
            <h2 className="list-heading">{LIST_TITLES[k]}</h2>
            <button
              className="btn btn-small add-btn"
              type="button"
              ref={(el) => {
                if (el) addBtnRefs.set(k, el);
              }}
              onClick={(e) => openNew(k, e.currentTarget)}
            >
              {ADD_LABELS[k]}
            </button>
            <TaskList
              listKey={k}
              tasks={listFor(k)}
              focus={focus}
              onFocusRow={(i) => {
                setFocus({ list: k, index: i });
                setLastIndex((p) => ({ ...p, [k]: i }));
              }}
              rowRefs={rowRefs}
              pending={pending}
              strikedChip={strikedChip}
              onScore={doScore}
              onToggle={doCompleteToggle}
              onBuy={doBuy}
              onEdit={(t, el) => {
                dialogReturnRef.current = el;
                setDialog({ kind: 'edit', task: t });
              }}
              onTickChecklist={(taskId, itemId, checked) => api.tickChecklist(taskId, itemId, checked).catch((e) => setError(errorText(e)))}
              emptyWord={EMPTY_WORDS[k]}
              emptySentence={EMPTY_SENTENCES[k]}
            />
          </section>
        ))}
        <PartyRail inDialog={false} />
      </div>

      <section className={`task-list rewards-band list-rewards ${phoneList === 'rewards' ? 'list-visible' : 'list-hidden'}`} aria-label="Rewards">
        <h2 className="list-heading">Rewards</h2>
        <button
          className="btn btn-small add-btn"
          type="button"
          ref={(el) => {
            if (el) addBtnRefs.set('rewards', el);
          }}
          onClick={(e) => openNew('rewards', e.currentTarget)}
        >
          Add reward
        </button>
        <TaskList
          listKey="rewards"
          tasks={listFor('rewards')}
          focus={focus}
          onFocusRow={(i) => {
            setFocus({ list: 'rewards', index: i });
            setLastIndex((p) => ({ ...p, rewards: i }));
          }}
          rowRefs={rowRefs}
          pending={pending}
          strikedChip={null}
          onScore={doScore}
          onToggle={doCompleteToggle}
          onBuy={doBuy}
          onEdit={(t, el) => {
            dialogReturnRef.current = el;
            setDialog({ kind: 'edit', task: t });
          }}
          onTickChecklist={() => Promise.resolve()}
          emptyWord={EMPTY_WORDS.rewards}
          emptySentence={EMPTY_SENTENCES.rewards}
        />
      </section>

      {dialog?.kind === 'new' && (
        <TaskDialog
          mode="new"
          listType={dialog.type}
          onClose={closeDialog}
          onCreated={afterCreate}
        />
      )}
      {dialog?.kind === 'edit' && (
        <TaskDialog
          mode="edit"
          task={dialog.task}
          onClose={closeDialog}
          onDeleted={() => afterDelete(dialog.task)}
        />
      )}
      {dialog?.kind === 'levelup' && (
        <LevelDialog
          level={dialog.level}
          onClose={() => {
            setDialog(null);
            const row = dialog.fromId ? rowRefs.current.get(dialog.fromId) : null;
            if (row) row.focus();
            else focusRow('habits', 0);
          }}
        />
      )}
      {dialog?.kind === 'faint' && (
        <FaintDialog
          level={dialog.level}
          goldLost={dialog.goldLost}
          onClose={() => {
            setDialog(null);
            const row = dialog.fromId ? rowRefs.current.get(dialog.fromId) : null;
            if (row) row.focus();
            else focusRow('habits', 0);
          }}
        />
      )}

      {showParty && (
        <div className="dialog-backdrop" role="dialog" aria-label="Party" onKeyDown={(e) => { if (e.key === 'Escape') setShowParty(false); }}>
          <div className="sheet party-sheet">
            <button className="btn btn-small sheet-close" type="button" onClick={() => setShowParty(false)}>Close</button>
            <PartyRail inDialog />
          </div>
        </div>
      )}
    </div>
  );
}

const addBtnRefs = new Map<string, HTMLButtonElement>();

function errorText(err: unknown): string {
  const failure = err as { status?: number; body?: { error?: string; errors?: Record<string, string> } };
  if (failure?.status === 413) return 'The file is larger than 100,000 bytes.';
  if (failure?.status === 415) return 'Choose a .deedlist text file.';
  if (failure?.status === 503) return 'File storage is unavailable. Nothing was imported.';
  if (failure?.body?.errors?.gold) return 'Not enough gold.';
  if (failure?.body?.error) return 'Something went wrong. Try again.';
  return 'Something went wrong. Try again.';
}

interface TaskListProps {
  listKey: ListKey;
  tasks: Task[];
  focus: BoardFocus;
  onFocusRow: (index: number) => void;
  rowRefs: MutableRefObject<Map<string, HTMLLIElement>>;
  pending: Set<string>;
  strikedChip: { id: string; damage: number } | null;
  onScore: (t: Task, dir: 'up' | 'down') => void;
  onToggle: (t: Task) => void;
  onBuy: (t: Task) => void;
  onEdit: (t: Task, el: HTMLElement | null) => void;
  onTickChecklist: (taskId: string, itemId: string, checked: boolean) => Promise<unknown>;
  emptyWord: string;
  emptySentence: string;
}

function TaskList(props: TaskListProps) {
  const { tasks, listKey } = props;
  if (tasks.length === 0) {
    return (
      <ul className="task-list-empty" aria-label={LIST_TITLES[listKey]}>
        <li className="empty-giant" aria-hidden="true">{props.emptyWord}</li>
        <li className="empty-sentence">{props.emptySentence}</li>
      </ul>
    );
  }
  return (
    <ul className="task-rows" aria-label={LIST_TITLES[listKey]}>
      {tasks.map((t, i) => (
        <TaskRow
          key={t.id}
          task={t}
          index={i}
          focused={props.focus.list === listKey && props.focus.index === i}
          onFocusRow={props.onFocusRow}
          rowRefs={props.rowRefs}
          pending={props.pending.has(t.id)}
          chipFlight={props.strikedChip?.id === t.id ? props.strikedChip.damage : null}
          onScore={props.onScore}
          onToggle={props.onToggle}
          onBuy={props.onBuy}
          onEdit={props.onEdit}
          onTickChecklist={props.onTickChecklist}
        />
      ))}
    </ul>
  );
}

interface TaskRowProps {
  task: Task;
  index: number;
  focused: boolean;
  onFocusRow: (index: number) => void;
  rowRefs: MutableRefObject<Map<string, HTMLLIElement>>;
  pending: boolean;
  chipFlight: number | null;
  onScore: (t: Task, dir: 'up' | 'down') => void;
  onToggle: (t: Task) => void;
  onBuy: (t: Task) => void;
  onEdit: (t: Task, el: HTMLElement | null) => void;
  onTickChecklist: (taskId: string, itemId: string, checked: boolean) => Promise<unknown>;
}

function TaskRow(p: TaskRowProps) {
  const { task: t } = p;
  const rowRef = useRef<HTMLLIElement | null>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (rowRef.current) p.rowRefs.current.set(t.id, rowRef.current);
    return () => {
      p.rowRefs.current.delete(t.id);
    };
  }, [t.id]);

  const name = accessibleName(t);
  const chip = t.type !== 'reward' ? <span className={`band-chip band-${t.band.toLowerCase()}`}>{t.band}</span> : null;

  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      className={`task-row type-${t.type} ${t.done ? 'task-done' : ''}`}
      aria-label={name}
      onFocus={() => p.onFocusRow(p.index)}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        if (dx >= 80 && !t.done && (t.type === 'daily' || t.type === 'todo')) {
          p.onToggle(t);
        }
      }}
    >
      <span className="row-title" onClick={(e) => p.onEdit(t, e.currentTarget)}>{t.title}</span>
      {chip}
      {p.chipFlight !== null && (
        <span className="damage-chip" aria-hidden="true">{MINUS}{fmt1(p.chipFlight)}</span>
      )}
      {t.type === 'habit' && (
        <span className="row-actions">
          <button
            className="round-btn"
            type="button"
            aria-label={`Score ${t.title} up`}
            disabled={p.pending}
            onClick={() => p.onScore(t, 'up')}
          >
            +
          </button>
          <button
            className="round-btn"
            type="button"
            aria-label={`Score ${t.title} down`}
            disabled={p.pending}
            onClick={() => p.onScore(t, 'down')}
          >
            −
          </button>
        </span>
      )}
      {(t.type === 'daily' || t.type === 'todo') && (
        <input
          type="checkbox"
          aria-label={`Complete ${t.title}`}
          checked={t.done}
          disabled={p.pending}
          onChange={() => p.onToggle(t)}
        />
      )}
      {t.type === 'todo' && t.checklist && t.checklist.length > 0 && (
        <ul className="checklist">
          {t.checklist.map((c) => (
            <li key={c.id}>
              <label>
                <input
                  type="checkbox"
                  aria-label={c.text}
                  checked={c.checked}
                  onChange={(e) => void p.onTickChecklist(t.id, c.id, e.target.checked)}
                />
                <span>{c.text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {t.type === 'reward' && (
        <span className="row-actions">
          <span className="price">{fmtGold(t.price ?? 0)}</span>
          <button
            className="btn btn-small"
            type="button"
            aria-label={`Buy ${t.title}`}
            disabled={p.pending}
            onClick={() => p.onBuy(t)}
          >
            Buy
          </button>
        </span>
      )}
    </li>
  );
}

/** The published accessible name for each row type. */
export function accessibleName(t: Task): string {
  const v = t.value < 0 ? `${t.value}` : `${t.value}`;
  if (t.type === 'habit') return `Habit: ${t.title}, score ${v}`;
  if (t.type === 'daily') {
    return `Daily: ${t.title}, ${t.dueToday ? 'due today' : 'not due today'}, streak ${t.streak}, ${t.done ? 'done' : 'not done'}`;
  }
  if (t.type === 'todo') {
    const base = t.checklist && t.checklist.length > 0
      ? `To-do: ${t.title}, ${t.checklist.filter((c) => c.checked).length} of ${t.checklist.length} checklist items, ${t.done ? 'done' : 'not done'}`
      : `To-do: ${t.title}, ${t.done ? 'done' : 'not done'}`;
    return base;
  }
  return `Reward: ${t.title}, costs ${fmtGold(t.price ?? 0)} gold`;
}
