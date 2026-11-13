import { useRef, useState } from 'react';
import type { Position, SquadViewPlayer } from '../../shared/types.ts';
import { formatMillions } from '../../shared/money.ts';

export const POSITION_WORDS: Record<Position, string> = {
  GK: 'goalkeeper',
  DEF: 'defender',
  MID: 'midfielder',
  FWD: 'forward',
};

export const shortName = (name: string): string => name.split(' ').at(-1) ?? name;

export interface PitchSlot {
  key: string;
  player: SquadViewPlayer | null;
}

export interface PitchRow {
  label: string;
  slots: PitchSlot[];
  bench: boolean;
}

export interface ShirtBadge {
  text: string;
  dimmed: boolean;
}

export interface PitchProps {
  rows: PitchRow[];
  view: 'pitch' | 'list';
  editable: boolean;
  /** Price while the gameweek is open, points once it is locked. */
  showPoints: boolean;
  selectedId: string | null;
  outIds?: string[];
  pointsOverride?: Record<string, number>;
  badges?: Record<string, ShirtBadge>;
  pulsingId?: string | null;
  onActivate: (slot: PitchSlot) => void;
  onEscape: () => void;
  onCaptain?: (playerId: string) => void;
  onViceCaptain?: (playerId: string) => void;
  toolbar?: React.ReactNode;
}

const nearest = (index: number, fromLength: number, toLength: number): number => {
  if (toLength === 0) return 0;
  const ratio = (index + 0.5) / fromLength;
  return Math.min(toLength - 1, Math.max(0, Math.floor(ratio * toLength)));
};

export const Pitch = ({
  rows,
  view,
  editable,
  showPoints,
  selectedId,
  outIds = [],
  pointsOverride = {},
  badges = {},
  pulsingId = null,
  onActivate,
  onEscape,
  onCaptain,
  onViceCaptain,
  toolbar,
}: PitchProps) => {
  const region = useRef<HTMLDivElement | null>(null);
  const lastOutfieldRow = rows.reduce(
    (found, row, index) => (row.bench ? found : index),
    0,
  );
  const [cursor, setCursor] = useState<{ row: number; slot: number }>(() => ({
    row: lastOutfieldRow,
    slot: 0,
  }));

  const flat = rows.flatMap((row, rowIndex) =>
    row.slots.map((slot, slotIndex) => ({ slot, rowIndex, slotIndex })),
  );
  const current =
    rows[cursor.row]?.slots[cursor.slot] === undefined
      ? { row: lastOutfieldRow, slot: 0 }
      : cursor;

  const focusSlot = (next: { row: number; slot: number }): void => {
    setCursor(next);
    const target = rows[next.row]?.slots[next.slot];
    if (target === undefined) return;
    window.requestAnimationFrame(() => {
      region.current
        ?.querySelector<HTMLButtonElement>(`[data-slot-key="${target.key}"]`)
        ?.focus();
    });
  };

  const moveFlat = (step: number): void => {
    const position = flat.findIndex(
      (entry) => entry.rowIndex === current.row && entry.slotIndex === current.slot,
    );
    const next = flat[Math.min(flat.length - 1, Math.max(0, position + step))];
    if (next !== undefined) focusSlot({ row: next.rowIndex, slot: next.slotIndex });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const row = rows[current.row];
    if (row === undefined) return;
    const armband = event.key.toLowerCase();
    const focusedId = (event.target as HTMLElement).closest<HTMLElement>('[data-player-id]')
      ?.dataset.playerId;
    const actingId = selectedId ?? focusedId ?? null;

    if (armband === 'c' && onCaptain !== undefined && actingId !== null) {
      event.preventDefault();
      onCaptain(actingId);
      return;
    }
    if (armband === 'v' && onViceCaptain !== undefined && actingId !== null) {
      event.preventDefault();
      onViceCaptain(actingId);
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
        if (view === 'list') return;
        event.preventDefault();
        focusSlot({ row: current.row, slot: Math.min(row.slots.length - 1, current.slot + 1) });
        return;
      case 'ArrowLeft':
        if (view === 'list') return;
        event.preventDefault();
        focusSlot({ row: current.row, slot: Math.max(0, current.slot - 1) });
        return;
      case 'ArrowDown': {
        event.preventDefault();
        if (view === 'list') {
          moveFlat(1);
          return;
        }
        const target = rows[current.row + 1];
        if (target === undefined) return;
        focusSlot({
          row: current.row + 1,
          slot: nearest(current.slot, row.slots.length, target.slots.length),
        });
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        if (view === 'list') {
          moveFlat(-1);
          return;
        }
        const target = rows[current.row - 1];
        if (target === undefined) return;
        focusSlot({
          row: current.row - 1,
          slot: nearest(current.slot, row.slots.length, target.slots.length),
        });
        return;
      }
      case 'Home':
        event.preventDefault();
        if (view === 'list') focusSlot({ row: 0, slot: 0 });
        else focusSlot({ row: current.row, slot: 0 });
        return;
      case 'End':
        event.preventDefault();
        if (view === 'list') {
          const last = flat.at(-1)!;
          focusSlot({ row: last.rowIndex, slot: last.slotIndex });
        } else {
          focusSlot({ row: current.row, slot: row.slots.length - 1 });
        }
        return;
      case 'Escape':
        event.preventDefault();
        onEscape();
        return;
      default:
        return;
    }
  };

  const renderShirt = (slot: PitchSlot, rowIndex: number, slotIndex: number) => {
    const isCursor = rowIndex === current.row && slotIndex === current.slot;
    const player = slot.player;
    if (player === null) {
      return (
        <button
          key={slot.key}
          type="button"
          className="shirt shirt-empty"
          data-slot-key={slot.key}
          tabIndex={isCursor ? 0 : -1}
          aria-label="Empty slot"
          onFocus={() => setCursor({ row: rowIndex, slot: slotIndex })}
          onClick={() => onActivate(slot)}
          disabled={!editable}
        >
          <span className="shirt-body shirt-body-empty" aria-hidden="true" />
        </button>
      );
    }
    const points = pointsOverride[player.id] ?? player.team_points;
    const armband = player.captain ? 'C' : player.vice_captain ? 'V' : null;
    const suffix = player.captain ? ', captain' : player.vice_captain ? ', vice-captain' : '';
    const markedOut = outIds.includes(player.id);
    const badge = badges[player.id];
    return (
      <button
        key={slot.key}
        type="button"
        className={`shirt${selectedId === player.id ? ' shirt-selected' : ''}${
          markedOut ? ' shirt-out' : ''
        }${pulsingId === player.id ? ' shirt-pulse' : ''}`}
        data-slot-key={slot.key}
        data-player-id={player.id}
        data-points={points}
        tabIndex={isCursor ? 0 : -1}
        aria-label={`${player.name}, ${POSITION_WORDS[player.position]}, ${points} points${suffix}`}
        {...(editable ? { 'aria-pressed': selectedId === player.id } : {})}
        onFocus={() => setCursor({ row: rowIndex, slot: slotIndex })}
        onClick={() => onActivate(slot)}
      >
        <span className="shirt-body" aria-hidden="true">
          <span className="shirt-club">{player.club}</span>
        </span>
        <span className="shirt-name">{shortName(player.name)}</span>
        <span className="shirt-figure mono">
          {showPoints
            ? points
            : markedOut
              ? `${formatMillions(player.selling_price_tenths)}m`
              : `${formatMillions(player.price_tenths)}m`}
        </span>
        {armband !== null && <span className="armband">{armband}</span>}
        {markedOut && <span className="out-tag">Out</span>}
        {badge !== undefined && (
          <span
            className={`relay-chip relay-chip-static${badge.dimmed ? ' relay-chip-dim' : ''}`}
            data-relay-chip
          >
            {badge.text}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      role="region"
      aria-label="Pitch"
      className={`pitch pitch-${view}`}
      ref={region}
      onKeyDown={onKeyDown}
    >
      {rows.map((row, rowIndex) =>
        row.bench ? (
          <div key={row.label} role="group" aria-label="Bench" className="pitch-row bench-tray">
            <span className="row-label">{row.label}</span>
            {row.slots.map((slot, slotIndex) => renderShirt(slot, rowIndex, slotIndex))}
          </div>
        ) : (
          <div key={row.label} className="pitch-row">
            <span className="row-label">{row.label}</span>
            {row.slots.map((slot, slotIndex) => renderShirt(slot, rowIndex, slotIndex))}
          </div>
        ),
      )}
      {toolbar}
    </div>
  );
};
