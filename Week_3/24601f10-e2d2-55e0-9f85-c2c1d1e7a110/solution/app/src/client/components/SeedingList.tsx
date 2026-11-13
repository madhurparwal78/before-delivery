import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { EntrantView, SeedingResult, TournamentView } from '../../shared/api.js';
import { api, failureOf } from '../api.js';
import type { TournamentStore } from '../liveStore.js';
import { clearError, raise } from '../notices.js';

type FocusKind = 'item' | 'seed';

// The seeding list: Alt+Arrow keys, a typed seed, or a drag moves an entrant; each move is saved at once.
export function SeedingList({ store, tournament, entrants, say }: {
  store: TournamentStore;
  tournament: TournamentView;
  entrants: EntrantView[];
  say: (text: string) => void;
}): ReactNode {
  const [override, setOverride] = useState<EntrantView[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const list = override ?? entrants;
  const focus = useRef<{ id: string; kind: FocusKind } | null>(null);
  const version = useRef(tournament.seeding_version);
  const inFlight = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const listRef = useRef<HTMLOListElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  version.current = Math.max(version.current, tournament.seeding_version);

  useLayoutEffect(() => {
    const target = focus.current;
    if (!target) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-entrant-id="${target.id}"]`);
    (target.kind === 'item' ? item : item?.querySelector<HTMLElement>('input[type="number"]'))?.focus();
    focus.current = null;
  }, [list]);

  const move = (id: string, to: number, kind: FocusKind): void => {
    const from = list.findIndex((e) => e.id === id);
    if (from < 0 || from === to || to < 0 || to >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(from, 1) as [EntrantView];
    next.splice(to, 0, moved);
    focus.current = { id, kind };
    setOverride(next.map((e, index) => ({ ...e, seed: index + 1 })));
    setDrafts({});
    setErrors({});
    clearError();
    inFlight.current += 1;
    queue.current = queue.current.then(async () => {
      try {
        const result = await api.put<SeedingResult>(`/api/tournaments/${tournament.id}/seeding`,
          { order: next.map((e) => e.id), seeding_version: version.current });
        version.current = result.seeding_version;
        store.applyEntrants(result.entrants, result.seeding_version);
        say(`${moved.name} moved to seed ${to + 1}`);
      } catch (error) {
        const failure = failureOf(error);
        raise(failure.message);
        if (failure.body.entrants) store.applyEntrants(failure.body.entrants, version.current);
        await store.load();
        version.current = store.getSnapshot().tournament?.seeding_version ?? version.current;
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setOverride(null);
      }
    });
  };

  const commitSeed = (entrant: EntrantView): void => {
    const text = drafts[entrant.id];
    if (text === undefined) return;
    const seed = Number(text);
    if (text.trim() === '' || !Number.isInteger(seed) || seed < 1 || seed > list.length) {
      setErrors((e) => ({ ...e, [entrant.id]: `Enter a seed from 1 to ${list.length}.` }));
      return;
    }
    setDrafts((d) => {
      const { [entrant.id]: _gone, ...rest } = d;
      return rest;
    });
    setErrors((e) => ({ ...e, [entrant.id]: '' }));
    if (seed !== entrant.seed) move(entrant.id, seed - 1, 'seed');
  };

  const commitAccount = async (entrant: EntrantView): Promise<void> => {
    const text = accounts[entrant.id];
    if (text === undefined || text === (entrant.username ?? '')) return;
    clearError();
    try {
      await api.patch(`/api/entrants/${entrant.id}`, { username: text.trim() === '' ? null : text.trim() });
      setErrors((e) => ({ ...e, [`a${entrant.id}`]: '' }));
      setAccounts((a) => {
        const { [entrant.id]: _gone, ...rest } = a;
        return rest;
      });
      await store.load();
    } catch (error) {
      const failure = failureOf(error);
      setErrors((e) => ({ ...e, [`a${entrant.id}`]: failure.body.fields?.['username'] ?? failure.message }));
    }
  };

  const remove = async (entrant: EntrantView): Promise<void> => {
    clearError();
    try {
      await api.del(`/api/entrants/${entrant.id}`);
      await store.load();
    } catch (error) {
      raise(failureOf(error).message);
    }
  };

  const itemKey = (event: KeyboardEvent<HTMLLIElement>, entrant: EntrantView, index: number): void => {
    if (event.target !== event.currentTarget || !event.altKey) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(entrant.id, index + (event.key === 'ArrowUp' ? -1 : 1), 'item');
    }
  };

  // Dragging an item by pointer or touch drops it at the new seed.
  const down = (event: PointerEvent<HTMLLIElement>, entrant: EntrantView): void => {
    const target = event.target as HTMLElement;
    if (target.closest('input, button')) return;
    if (event.pointerType !== 'mouse' && !target.closest('.seed-grip')) return;
    drag.current = { id: entrant.id, x: event.clientX, y: event.clientY, moved: false };
    const onMove = (e: globalThis.PointerEvent): void => {
      const state = drag.current;
      if (state && Math.hypot(e.clientX - state.x, e.clientY - state.y) > 4) state.moved = true;
    };
    const onUp = (e: globalThis.PointerEvent): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const state = drag.current;
      drag.current = null;
      if (!state?.moved) return;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-entrant-id]');
      const index = over ? [...(listRef.current?.children ?? [])].indexOf(over) : -1;
      if (index >= 0) move(state.id, index, 'item');
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return (
    <ol ref={listRef} aria-label="Seeding" className="plain-list seeding">
      {list.map((entrant, index) => (
        <li key={entrant.id} tabIndex={0} aria-label={`${entrant.seed}. ${entrant.name}`} data-entrant-id={entrant.id}
          className="seed-item" onKeyDown={(event) => itemKey(event, entrant, index)} onPointerDown={(event) => down(event, entrant)}>
          <span className="seed-grip" aria-hidden="true" />
          <span className="seed-name">{entrant.name}</span>
          <div className="seed-controls">
            <div className="seed-control">
              <input type="number" aria-label={`Seed for ${entrant.name}`} min={1} max={list.length} value={drafts[entrant.id] ?? String(entrant.seed)}
                onChange={(event) => setDrafts((d) => ({ ...d, [entrant.id]: event.target.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitSeed(entrant); } }}
                onBlur={() => commitSeed(entrant)} />
              {errors[entrant.id] ? <span className="field-error">{errors[entrant.id]}</span> : null}
            </div>
            <div className="seed-control seed-account">
              <input type="text" aria-label={`Account for ${entrant.name}`} placeholder="@account" autoCapitalize="none" spellCheck={false}
                value={accounts[entrant.id] ?? entrant.username ?? ''}
                onChange={(event) => setAccounts((a) => ({ ...a, [entrant.id]: event.target.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void commitAccount(entrant); } }}
                onBlur={() => void commitAccount(entrant)} />
              {errors[`a${entrant.id}`] ? <span className="field-error">{errors[`a${entrant.id}`]}</span> : null}
            </div>
            <button type="button" className="btn btn-quiet" onClick={() => void remove(entrant)}>{`Remove ${entrant.name}`}</button>
          </div>
        </li>
      ))}
    </ol>
  );
}
