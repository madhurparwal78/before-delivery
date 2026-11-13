import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Club, PlayerRow, Position } from '../../shared/types.ts';
import { deadlineCopy, lockedBannerCopy } from '../../shared/copy.ts';
import { formatMillions } from '../../shared/money.ts';
import { api, RequestFailed } from '../api.ts';
import { LiveRegion, useAnnounce } from '../live.tsx';
import { navigate, useLocation } from '../router.tsx';
import { useApp } from '../state.tsx';
import { ChipsBar, Ledger } from '../components/Ledger.tsx';
import { Dialog } from '../components/Dialog.tsx';
import {
  POSITION_WORDS,
  Pitch,
  type PitchRow,
  type PitchSlot,
} from '../components/Pitch.tsx';
import { squadRows, useChipActions } from './Team.tsx';

const SORT_LABELS: { value: string; label: string }[] = [
  { value: 'price_desc', label: 'Highest price' },
  { value: 'price_asc', label: 'Lowest price' },
  { value: 'points_desc', label: 'Most points' },
  { value: 'name_asc', label: 'Name' },
];

const MAX_PRICES = Array.from({ length: 15 }, (_, index) =>
  formatMillions(40 + index * 5),
);

const BUILDER_SHAPE: { position: Position; count: number; label: string }[] = [
  { position: 'FWD', count: 3, label: 'Forwards' },
  { position: 'MID', count: 5, label: 'Midfielders' },
  { position: 'DEF', count: 5, label: 'Defenders' },
  { position: 'GK', count: 2, label: 'Goalkeepers' },
];

const newIdempotencyKey = (): string =>
  `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const Transfers = () => {
  const { gameweek, squad, hasSquad, draft, refreshSquad, refreshDraft } = useApp();
  const announce = useAnnounce();
  const location = useLocation();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const view = params.get('view') === 'list' ? 'list' : 'pitch';
  const position = params.get('position') ?? '';
  const club = params.get('club') ?? '';
  const maxPrice = params.get('max_price') ?? '';
  const sort = params.get('sort') ?? 'price_desc';

  const [clubs, setClubs] = useState<Club[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [playerCache, setPlayerCache] = useState<Record<string, PlayerRow>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [builder, setBuilder] = useState<(string | null)[]>(() =>
    BUILDER_SHAPE.flatMap((row) => Array.from({ length: row.count }, () => null)),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const reviewButton = useRef<HTMLButtonElement | null>(null);
  const listBox = useRef<HTMLUListElement | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    void api.clubs().then((result) => setClubs(result.clubs));
  }, []);

  useEffect(() => {
    const search = new URLSearchParams();
    if (position !== '') search.set('position', position);
    if (club !== '') search.set('club', club);
    if (maxPrice !== '') search.set('max_price', maxPrice);
    search.set('sort', sort);
    void api
      .players(`?${search.toString()}`)
      .then((result) => {
        setPlayers(result.players);
        setPlayerCache((current) => {
          const next = { ...current };
          for (const player of result.players) next[player.id] = player;
          return next;
        });
      })
      .catch(() => setPlayers([]));
  }, [position, club, maxPrice, sort]);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      if (value === '') next.delete(key);
      else next.set(key, value);
      navigate(`/transfers?${next.toString()}`);
    },
    [params],
  );

  const gameweekNumber = gameweek?.number ?? 1;
  const chipActions = useChipActions(squad, gameweekNumber, refreshSquad);
  const locked = gameweek !== null && gameweek.status !== 'open';
  const editable = !locked;

  const outIds = draft?.out ?? [];
  const inIds = draft?.in ?? [];
  const preview = draft?.preview ?? null;

  const refuse = useCallback(
    (error: unknown, prefix: string): void => {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.body.error === 'gameweek_locked' || error.body.error === 'gameweek_not_open') {
        announce('Team updates', deadlineCopy(gameweekNumber));
        return;
      }
      if (error.body.error === 'hit_changed') {
        announce(
          'Team updates',
          `The hit is now ${error.body.hit_points ?? 0} points. Check it and confirm again.`,
        );
        return;
      }
      if (error.body.rules !== undefined) {
        announce(
          'Team updates',
          `${prefix}: ${error.body.rules.map((rule) => rule.message).join('; ')}.`,
        );
        return;
      }
      announce('Team updates', `${prefix}: ${error.body.message}`);
    },
    [announce, gameweekNumber],
  );

  const writeDraft = useCallback(
    async (out: string[], incoming: string[]): Promise<void> => {
      try {
        await api.saveDraft(gameweekNumber, out, incoming);
        await refreshDraft();
      } catch (error) {
        refuse(error, 'Transfers refused');
      }
    },
    [gameweekNumber, refreshDraft, refuse],
  );

  const toggleOut = (playerId: string): void => {
    const index = outIds.indexOf(playerId);
    if (index === -1) {
      void writeDraft([...outIds, playerId], inIds);
      return;
    }
    const out = outIds.filter((_, position) => position !== index);
    const incoming = inIds.filter((_, position) => position !== index);
    void writeDraft(out, incoming);
  };

  const unmarkLatest = (): void => {
    if (outIds.length <= inIds.length) return;
    void writeDraft(outIds.slice(0, -1), inIds);
  };

  const bringIn = (player: PlayerRow): void => {
    if (!hasSquad) {
      const slots = BUILDER_SHAPE.flatMap((row) =>
        Array.from({ length: row.count }, () => row.position),
      );
      const target = slots.findIndex(
        (slotPosition, index) => slotPosition === player.position && builder[index] === null,
      );
      if (target === -1) {
        announce('Team updates', `No ${POSITION_WORDS[player.position]} slot is free.`);
        return;
      }
      setBuilder((current) => current.map((id, index) => (index === target ? player.id : id)));
      return;
    }
    const slot = outIds.findIndex(
      (id, index) =>
        index >= inIds.length &&
        squad?.players.find((entry) => entry.id === id)?.position === player.position,
    );
    if (slot === -1) {
      announce('Team updates', `Mark a ${POSITION_WORDS[player.position]} to sell first.`);
      return;
    }
    const out = [...outIds];
    const swapAt = inIds.length;
    [out[swapAt], out[slot]] = [out[slot]!, out[swapAt]!];
    void writeDraft(out, [...inIds, player.id]);
  };

  const builderSpend = builder.reduce(
    (total, id) => total + (id === null ? 0 : (playerCache[id]?.price_tenths ?? 0)),
    0,
  );

  const builderRows: PitchRow[] = (() => {
    let cursor = 0;
    return BUILDER_SHAPE.map((row) => {
      const slots: PitchSlot[] = Array.from({ length: row.count }, () => {
        const index = cursor;
        cursor += 1;
        const id = builder[index] ?? null;
        const found = id === null ? null : playerCache[id];
        return {
          key: `slot-${index}`,
          player:
            found === undefined || found === null
              ? null
              : {
                  id: found.id,
                  name: found.name,
                  club: found.club,
                  position: found.position,
                  purchase_price_tenths: found.price_tenths,
                  price_tenths: found.price_tenths,
                  selling_price_tenths: found.price_tenths,
                  slot: 'starting',
                  bench_order: null,
                  captain: false,
                  vice_captain: false,
                  raw_points: 0,
                  team_points: 0,
                },
        };
      });
      return { label: row.label, slots, bench: false };
    });
  })();

  const onPitchActivate = (slot: PitchSlot): void => {
    if (!editable) return;
    if (!hasSquad) {
      const index = Number(slot.key.replace('slot-', ''));
      setBuilder((current) => current.map((id, position) => (position === index ? null : id)));
      return;
    }
    if (slot.player === null) return;
    toggleOut(slot.player.id);
  };

  const confirmSquad = async (): Promise<void> => {
    const chosen = builder.filter((id): id is string => id !== null);
    setPending('squad');
    try {
      const view = await api.createSquad(chosen);
      await refreshSquad();
      announce('Team updates', `Squad confirmed. Bank ${formatMillions(view.bank_tenths)}m.`);
      navigate('/team');
    } catch (error) {
      refuse(error, 'Squad refused');
    } finally {
      setPending(null);
    }
  };

  const confirmTransfers = async (): Promise<void> => {
    if (preview === null) return;
    setPending('transfers');
    try {
      const result = await api.confirmTransfers(
        gameweekNumber,
        outIds,
        inIds,
        preview.hit_points,
        idempotencyKey.current,
      );
      idempotencyKey.current = newIdempotencyKey();
      setConfirmOpen(false);
      await refreshSquad();
      await refreshDraft();
      announce(
        'Team updates',
        `Transfers confirmed: ${result.transfers.length} made, hit ${result.hit_points} points, bank ${formatMillions(result.bank_tenths)}m.`,
      );
    } catch (error) {
      await refreshDraft();
      refuse(error, 'Transfers refused');
    } finally {
      setPending(null);
    }
  };

  const resetDraft = async (): Promise<void> => {
    setPending('reset');
    try {
      await api.clearDraft();
      await refreshDraft();
    } finally {
      setPending(null);
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(players.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(0, players.length - 1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const player = players[activeIndex];
      if (player !== undefined && editable) bringIn(player);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      document
        .querySelector<HTMLElement>('[role="region"][aria-label="Pitch"] [tabindex="0"]')
        ?.focus();
    }
  };

  useEffect(() => {
    if (listBox.current === null) return;
    listBox.current
      .querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (gameweek === null) return <p className="empty">Loading transfers…</p>;

  const pairs = inIds.map((inId, index) => ({
    out: squad?.players.find((entry) => entry.id === outIds[index]),
    in: players.find((entry) => entry.id === inId) ?? playerCache[inId],
  }));

  return (
    <div className="board">
      <section className="board-main">
        <h1>{hasSquad ? 'Transfers' : 'Build your squad'}</h1>
        {locked && (
          <p role="status" aria-label="Locked banner" className="locked-banner">
            {lockedBannerCopy(gameweek.number)}
          </p>
        )}
        <div role="radiogroup" aria-label="View" className="view-toggle">
          <button
            type="button"
            role="radio"
            aria-checked={view === 'pitch'}
            onClick={() => setParam('view', 'pitch')}
          >
            Pitch
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={view === 'list'}
            onClick={() => setParam('view', 'list')}
          >
            List
          </button>
        </div>

        <Pitch
          rows={hasSquad && squad !== null ? squadRows(squad, view) : builderRows}
          view={view}
          editable={editable}
          showPoints={locked}
          selectedId={null}
          outIds={outIds}
          onActivate={onPitchActivate}
          onEscape={unmarkLatest}
        />

        <div className="draft-bar">
          <p role="status" aria-label="Draft preview" className="draft-preview mono">
            {preview === null
              ? ''
              : `Transfers ${preview.count} · Free used ${preview.free_transfers_used} · Hit -${preview.hit_points} pts · Bank ${formatMillions(preview.bank_after_tenths)}m`}
          </p>
          {hasSquad ? (
            <>
              <button
                type="button"
                ref={reviewButton}
                disabled={!editable}
                onClick={() => setConfirmOpen(true)}
              >
                Review transfers
              </button>
              <button
                type="button"
                disabled={!editable || pending === 'reset'}
                onClick={() => void resetDraft()}
              >
                {pending === 'reset' ? 'Resetting…' : 'Reset draft'}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!editable || pending === 'squad'}
              onClick={() => void confirmSquad()}
            >
              {pending === 'squad' ? 'Confirming…' : 'Confirm squad'}
            </button>
          )}
        </div>

        <div className="player-filters">
          <label htmlFor="filter-position">Position</label>
          <select
            id="filter-position"
            value={position}
            onChange={(event) => setParam('position', event.target.value)}
          >
            <option value="">All</option>
            <option value="GK">Goalkeepers</option>
            <option value="DEF">Defenders</option>
            <option value="MID">Midfielders</option>
            <option value="FWD">Forwards</option>
          </select>

          <label htmlFor="filter-club">Club</label>
          <select
            id="filter-club"
            value={club}
            onChange={(event) => setParam('club', event.target.value)}
          >
            <option value="">All clubs</option>
            {clubs.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
          </select>

          <label htmlFor="filter-max-price">Max price</label>
          <select
            id="filter-max-price"
            value={maxPrice}
            onChange={(event) => setParam('max_price', event.target.value)}
          >
            <option value="">Any</option>
            {MAX_PRICES.map((price) => (
              <option key={price} value={price}>
                {price}m
              </option>
            ))}
          </select>

          <label htmlFor="filter-sort">Sort</label>
          <select
            id="filter-sort"
            value={sort}
            onChange={(event) => setParam('sort', event.target.value)}
          >
            {SORT_LABELS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        <ul
          role="listbox"
          aria-label="Players"
          className="player-list"
          tabIndex={0}
          ref={listBox}
          aria-activedescendant={players[activeIndex] === undefined ? undefined : `option-${players[activeIndex]!.id}`}
          onKeyDown={onListKeyDown}
        >
          {players.map((player, index) => (
            <li
              key={player.id}
              id={`option-${player.id}`}
              role="option"
              data-option-index={index}
              data-player-id={player.id}
              aria-selected={index === activeIndex}
              aria-label={`${player.name}, ${player.club}, ${POSITION_WORDS[player.position]}, ${formatMillions(player.price_tenths)}m`}
              className={index === activeIndex ? 'option option-active' : 'option'}
              onClick={() => {
                setActiveIndex(index);
                if (editable) bringIn(player);
              }}
            >
              <span className="option-name">{player.name}</span>
              <span className="option-club">{player.club}</span>
              <span className="option-position">{POSITION_WORDS[player.position]}</span>
              <span className="option-price mono">{formatMillions(player.price_tenths)}m</span>
            </li>
          ))}
        </ul>

        <LiveRegion name="Team updates" />
      </section>

      {hasSquad && squad !== null ? (
        <Ledger
          squad={squad}
          gameweekTotal={squad.gameweek_total}
          rollingTotal={false}
          chips={
            <ChipsBar
              squad={squad}
              editable={editable}
              pendingChip={chipActions.pendingChip}
              onChipPressed={chipActions.onChipPressed}
            />
          }
          leagueTable={null}
        />
      ) : (
        <aside aria-label="Ledger" className="rail">
          <div className="rail-figures">
            <div className="figure">
              <span className="figure-label">Bank</span>
              <span className="figure-value mono">{formatMillions(1000 - builderSpend)}m</span>
            </div>
            <div className="figure">
              <span className="figure-label">Squad value</span>
              <span className="figure-value mono">{formatMillions(builderSpend)}m</span>
            </div>
          </div>
        </aside>
      )}

      {confirmOpen && (
        <Dialog
          title="Confirm transfers"
          onClose={() => setConfirmOpen(false)}
          returnFocusTo={reviewButton.current}
          initialFocus="last"
        >
          <ul className="transfer-pairs">
            {pairs.map((pair, index) => (
              <li key={index}>
                {`${pair.out?.name ?? ''} → ${pair.in?.name ?? ''}`}
              </li>
            ))}
          </ul>
          <p className="mono">{`Hit -${preview?.hit_points ?? 0} pts`}</p>
          <p className="mono">{`Bank afterwards ${formatMillions(preview?.bank_after_tenths ?? 0)}m`}</p>
          <div className="dialog-actions">
            <button
              type="button"
              disabled={pending === 'transfers'}
              onClick={() => void confirmTransfers()}
            >
              {pending === 'transfers' ? 'Confirming…' : 'Confirm transfers'}
            </button>
            <button type="button" onClick={() => setConfirmOpen(false)}>
              Keep editing
            </button>
          </div>
        </Dialog>
      )}
      {chipActions.dialog}
    </div>
  );
};
