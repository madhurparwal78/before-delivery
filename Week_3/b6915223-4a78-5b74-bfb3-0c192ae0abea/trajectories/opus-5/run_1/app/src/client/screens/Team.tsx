import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChipCode, SquadView, StandingRow } from '../../shared/types.ts';
import { CHIP_NAMES, chipRefusalCopy, deadlineCopy, lockedBannerCopy } from '../../shared/copy.ts';
import { api, RequestFailed } from '../api.ts';
import { LiveRegion, useAnnounce } from '../live.tsx';
import { navigate, useLocation } from '../router.tsx';
import { useApp, useReducedMotion } from '../state.tsx';
import { ChipsBar, Ledger, useIsPhone } from '../components/Ledger.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { Pitch, type PitchRow, type PitchSlot } from '../components/Pitch.tsx';
import { StandingsTable } from '../components/Standings.tsx';
import { relayAnnouncement, useRelay } from '../components/relay.ts';

const CHIP_DESCRIPTIONS: Record<ChipCode, string> = {
  wildcard: 'Every transfer this gameweek is free and permanent.',
  free_hit: 'Every transfer this gameweek is free and is reverted when the gameweek closes.',
  bench_boost: 'All fifteen players score this gameweek.',
  triple_captain: 'Your captain scores three times instead of twice.',
};

export const squadRows = (squad: SquadView, view: 'pitch' | 'list'): PitchRow[] => {
  const starters = squad.players.filter((player) => player.slot === 'starting');
  const bench = squad.players
    .filter((player) => player.slot === 'bench')
    .sort((a, b) => (a.bench_order ?? 0) - (b.bench_order ?? 0));
  const slots = (list: typeof starters): PitchSlot[] =>
    list.map((player) => ({ key: player.id, player }));

  if (view === 'list') {
    return [
      { label: 'Starters', slots: slots(starters), bench: false },
      { label: 'Bench', slots: slots(bench), bench: true },
    ];
  }
  return [
    { label: 'Forwards', slots: slots(starters.filter((p) => p.position === 'FWD')), bench: false },
    {
      label: 'Midfielders',
      slots: slots(starters.filter((p) => p.position === 'MID')),
      bench: false,
    },
    { label: 'Defenders', slots: slots(starters.filter((p) => p.position === 'DEF')), bench: false },
    { label: 'Goalkeeper', slots: slots(starters.filter((p) => p.position === 'GK')), bench: false },
    { label: 'Bench', slots: slots(bench), bench: true },
  ];
};

export const useChipActions = (
  squad: SquadView | null,
  gameweekNumber: number,
  refreshSquad: () => Promise<void>,
) => {
  const announce = useAnnounce();
  const [pendingChip, setPendingChip] = useState<ChipCode | null>(null);
  const [dialogChip, setDialogChip] = useState<ChipCode | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const refuse = (error: unknown, chip: ChipCode): void => {
    if (!(error instanceof RequestFailed)) throw error;
    if (error.body.error === 'gameweek_locked' || error.body.error === 'gameweek_not_open') {
      announce('Team updates', deadlineCopy(gameweekNumber));
      return;
    }
    announce('Team updates', chipRefusalCopy(error.body.error, chip));
  };

  const onChipPressed = (chip: ChipCode): void => {
    opener.current = document.activeElement as HTMLElement | null;
    if (squad?.chip === chip) {
      setPendingChip(chip);
      void api
        .cancelChip(gameweekNumber)
        .then(async () => {
          await refreshSquad();
          announce('Team updates', `${CHIP_NAMES[chip]} cancelled.`);
        })
        .catch((error: unknown) => refuse(error, chip))
        .finally(() => setPendingChip(null));
      return;
    }
    setDialogChip(chip);
  };

  const play = (chip: ChipCode): void => {
    setDialogChip(null);
    setPendingChip(chip);
    void api
      .playChip(gameweekNumber, chip)
      .then(async () => {
        await refreshSquad();
        announce('Team updates', `${CHIP_NAMES[chip]} played for gameweek ${gameweekNumber}.`);
      })
      .catch((error: unknown) => refuse(error, chip))
      .finally(() => setPendingChip(null));
  };

  const dialog =
    dialogChip === null ? null : (
      <Dialog
        title={`Play ${CHIP_NAMES[dialogChip]}`}
        onClose={() => setDialogChip(null)}
        returnFocusTo={opener.current}
      >
        <p>{CHIP_DESCRIPTIONS[dialogChip]}</p>
        <div className="dialog-actions">
          <button type="button" onClick={() => play(dialogChip)}>
            {`Play ${CHIP_NAMES[dialogChip]}`}
          </button>
          <button type="button" onClick={() => setDialogChip(null)}>
            Not now
          </button>
        </div>
      </Dialog>
    );

  return { pendingChip, onChipPressed, dialog };
};

export const useLeagueTable = (leagueParam: string | null) => {
  const { onStandings } = useApp();
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [leagueId, setLeagueId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = (await api.leagues()).leagues;
    const chosen = leagueParam ?? list[0]?.id ?? null;
    setLeagueId(chosen);
    setStandings(chosen === null ? [] : (await api.league(chosen)).standings);
  }, [leagueParam]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => onStandings(() => void refresh()), [onStandings, refresh]);

  return { standings, leagueId, refresh };
};

export const Team = () => {
  const { me, gameweek, squad, refreshSquad, onPoints } = useApp();
  const announce = useAnnounce();
  const location = useLocation();
  const phone = useIsPhone();
  const reducedMotion = useReducedMotion();

  const params = new URLSearchParams(location.search);
  const view = params.get('view') === 'list' ? 'list' : 'pitch';
  const table = useLeagueTable(params.get('league'));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onRowMove = useCallback(() => {
    void table.refresh();
  }, [table.refresh]);

  const { state: relayState, play: relayPlay } = useRelay({
    reducedMotion,
    managerId: me?.id ?? '',
    onRowMove,
  });

  useEffect(
    () =>
      onPoints((update) => {
        announce('Live points', relayAnnouncement(update, update.gameweek_total));
        relayPlay(update);
      }),
    [onPoints, announce, relayPlay],
  );

  const gameweekNumber = gameweek?.number ?? 1;
  const chipActions = useChipActions(squad, gameweekNumber, refreshSquad);

  const announceRef = useRef(announce);
  announceRef.current = announce;

  const save = useCallback(
    async (
      payload: { starting: string[]; bench: string[]; captain: string; vice_captain: string },
      success: string,
      refusalPrefix: 'Swap refused' | 'Captain refused',
    ): Promise<void> => {
      setPending(true);
      try {
        await api.savePicks({ gameweek: gameweekNumber, ...payload });
        await refreshSquad();
        announceRef.current('Team updates', success);
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        if (error.body.error === 'gameweek_locked' || error.body.error === 'gameweek_not_open') {
          announceRef.current('Team updates', deadlineCopy(gameweekNumber));
        } else if (error.body.rules !== undefined) {
          announceRef.current(
            'Team updates',
            `${refusalPrefix}: ${error.body.rules.map((rule) => rule.message).join('; ')}.`,
          );
        } else {
          announceRef.current('Team updates', `${refusalPrefix}: ${error.body.message}`);
        }
      } finally {
        setPending(false);
        setSelectedId(null);
      }
    },
    [gameweekNumber, refreshSquad],
  );

  if (squad === null || gameweek === null) {
    return <p className="empty">Loading your team…</p>;
  }

  const editable = squad.editable;
  const locked = gameweek.status !== 'open';
  const starters = squad.players.filter((player) => player.slot === 'starting');
  const bench = squad.players
    .filter((player) => player.slot === 'bench')
    .sort((a, b) => (a.bench_order ?? 0) - (b.bench_order ?? 0));
  const byId = (id: string) => squad.players.find((player) => player.id === id)!;
  const captainId = squad.players.find((player) => player.captain)!.id;
  const viceId = squad.players.find((player) => player.vice_captain)!.id;
  const startingIds = starters.map((player) => player.id);
  const benchIds = bench.map((player) => player.id);

  const pairUp = (firstId: string, secondId: string): void => {
    const first = byId(firstId);
    const second = byId(secondId);
    if (first.slot === 'starting' && second.slot === 'starting') {
      setSelectedId(secondId);
      return;
    }
    if (first.slot === 'bench' && second.slot === 'bench') {
      const order = [...benchIds];
      const a = order.indexOf(firstId);
      const b = order.indexOf(secondId);
      [order[a], order[b]] = [order[b]!, order[a]!];
      void save(
        { starting: startingIds, bench: order, captain: captainId, vice_captain: viceId },
        'Bench order saved.',
        'Swap refused',
      );
      return;
    }
    const starter = first.slot === 'starting' ? first : second;
    const benched = first.slot === 'bench' ? first : second;
    void save(
      {
        starting: startingIds.map((id) => (id === starter.id ? benched.id : id)),
        bench: benchIds.map((id) => (id === benched.id ? starter.id : id)),
        captain: captainId,
        vice_captain: viceId,
      },
      `${benched.name} moves into the eleven for ${starter.name}.`,
      'Swap refused',
    );
  };

  const onActivate = (slot: PitchSlot): void => {
    if (slot.player === null || !editable || pending) return;
    if (selectedId === null) {
      setSelectedId(slot.player.id);
      return;
    }
    if (selectedId === slot.player.id) return;
    pairUp(selectedId, slot.player.id);
  };

  const setCaptain = (playerId: string): void => {
    if (!editable || pending) return;
    void save(
      { starting: startingIds, bench: benchIds, captain: playerId, vice_captain: viceId },
      `${byId(playerId).name} is now captain.`,
      'Captain refused',
    );
  };

  const setViceCaptain = (playerId: string): void => {
    if (!editable || pending) return;
    void save(
      { starting: startingIds, bench: benchIds, captain: captainId, vice_captain: playerId },
      `${byId(playerId).name} is now vice-captain.`,
      'Captain refused',
    );
  };

  const setView = (next: 'pitch' | 'list'): void => {
    const search = new URLSearchParams(location.search);
    search.set('view', next);
    navigate(`/team?${search.toString()}`);
  };

  const leagueTable =
    table.leagueId === null ? (
      <p className="empty">Join or create a mini league to see it move.</p>
    ) : (
      <StandingsTable
        label="League table"
        rows={table.standings}
        movingManagerId={relayState.movingManagerId}
      />
    );

  const toolbar =
    selectedId === null || !editable ? null : (
      <div role="toolbar" aria-label="Player actions" className="player-actions">
        <button type="button" disabled={pending} onClick={() => setCaptain(selectedId)}>
          {pending ? 'Saving…' : 'Make captain'}
        </button>
        <button type="button" disabled={pending} onClick={() => setViceCaptain(selectedId)}>
          {pending ? 'Saving…' : 'Make vice-captain'}
        </button>
        <button type="button" onClick={() => setSelectedId(null)}>
          Cancel selection
        </button>
      </div>
    );

  return (
    <div className="board">
      <section className="board-main">
        <h1>{locked ? `Gameweek ${gameweek.number} points` : 'Pick Team'}</h1>
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
            onClick={() => setView('pitch')}
          >
            Pitch
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
        <Pitch
          rows={squadRows(squad, view)}
          view={view}
          editable={editable && !pending}
          showPoints={locked}
          selectedId={selectedId}
          pointsOverride={relayState.pointsOverride}
          badges={relayState.badges}
          pulsingId={relayState.pulsingId}
          onActivate={onActivate}
          onEscape={() => setSelectedId(null)}
          onCaptain={editable ? setCaptain : undefined}
          onViceCaptain={editable ? setViceCaptain : undefined}
          toolbar={toolbar}
        />
        {phone && leagueTable}
        <LiveRegion name="Team updates" />
        <LiveRegion name="Live points" />
      </section>
      <Ledger
        squad={squad}
        gameweekTotal={relayState.totalOverride ?? squad.gameweek_total}
        rollingTotal={relayState.rolling}
        chips={
          <ChipsBar
            squad={squad}
            editable={editable}
            pendingChip={chipActions.pendingChip}
            onChipPressed={chipActions.onChipPressed}
          />
        }
        leagueTable={phone ? null : leagueTable}
      />
      {chipActions.dialog}
      {relayState.flying !== null && (
        <span
          key={relayState.flying.key}
          className="relay-chip relay-chip-flying"
          data-relay-chip
          style={
            {
              left: `${relayState.flying.from.x}px`,
              top: `${relayState.flying.from.y}px`,
              '--relay-dx': `${relayState.flying.to.x - relayState.flying.from.x}px`,
              '--relay-dy': `${relayState.flying.to.y - relayState.flying.from.y}px`,
            } as React.CSSProperties
          }
        >
          {relayState.flying.text}
        </span>
      )}
    </div>
  );
};
