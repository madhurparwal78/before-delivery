import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { FloorResponse } from '../../shared/types';

export type TableVariant =
  | 'fits'
  | 'muted'
  | 'taken'
  | 'held'
  | 'free'
  | 'booked'
  | 'seated'
  | 'offered';

export interface PlanOption {
  /** The table id, or the pair id for a joined pair. */
  unitId: string;
  roomId: string;
  tableIds: string[];
  accessibleName: string;
  statusText: string;
  variant: TableVariant;
  maxSeats: number;
  /** How many place settings belong on the table: the party size of a live hold, or 0. */
  settings: number;
  ring?: { fraction: number } | null;
  disabled?: boolean;
}

interface FloorPlanProps {
  floor: FloorResponse;
  label: string;
  options: PlanOption[];
  reducedMotion: boolean;
  onActivate: (option: PlanOption) => void;
  /** A table to move focus to, for example the one a release just freed. */
  focusUnit?: string | null;
  onFocusHandled?: () => void;
}

function seatAngles(count: number): number[] {
  return Array.from({ length: count }, (_, index) => -90 + (index * 360) / count);
}

function polar(angle: number, radiusX: number, radiusY: number): { left: string; top: string } {
  const radians = (angle * Math.PI) / 180;
  return {
    left: `calc(50% + ${Math.cos(radians) * radiusX}px)`,
    top: `calc(50% + ${Math.sin(radians) * radiusY}px)`,
  };
}

function usePlaceSettingCount(target: number, reducedMotion: boolean): number {
  const [count, setCount] = useState(reducedMotion ? target : 0);
  const previous = useRef(reducedMotion ? target : 0);

  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    if (reducedMotion) {
      setCount(target);
      return undefined;
    }
    const timers: number[] = [];
    if (target > from) {
      for (let k = from + 1; k <= target; k += 1) {
        timers.push(window.setTimeout(() => setCount(k), (k - from - 1) * 70));
      }
    } else if (target < from) {
      for (let k = from - 1; k >= target; k -= 1) {
        timers.push(window.setTimeout(() => setCount(k), 180 + (from - 1 - k) * 40));
      }
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [target, reducedMotion]);

  return count;
}

function TableFigure({
  option,
  reducedMotion,
}: {
  option: PlanOption;
  reducedMotion: boolean;
}): JSX.Element {
  const settings = usePlaceSettingCount(option.settings, reducedMotion);
  const round = option.maxSeats === 2;
  const width = round ? 56 : 40 + option.maxSeats * 12;
  const angles = seatAngles(option.maxSeats);
  const radiusX = width / 2 + 11;
  const radiusY = 56 / 2 + 11;

  return (
    <span className="table-figure" style={{ width: `${width}px` }}>
      <span className={`table-shape table-shape--${round ? 'round' : 'rect'}`} />
      {angles.map((angle, index) => {
        const position = polar(angle, radiusX, radiusY);
        const used = index < option.settings;
        return (
          <span
            key={`seat-${index}`}
            className={`seat-mark${used ? '' : ' seat-mark--unused'}`}
            style={position}
          />
        );
      })}
      {angles.slice(0, settings).map((angle, index) => {
        const position = polar(angle, radiusX - 14, radiusY - 14);
        return (
          <span
            key={`setting-${index}`}
            role="img"
            aria-label={`Place setting ${index + 1} of ${option.settings}, table ${option.unitId}`}
            className={`place-setting${reducedMotion ? ' place-setting--still' : ''}`}
            style={position}
          />
        );
      })}
      {option.ring ? (
        <span
          aria-hidden="true"
          className={`hold-ring${reducedMotion ? ' hold-ring--stepped' : ''}`}
          style={{
            ['--ring-fraction' as string]: `${option.ring.fraction * 360}deg`,
          }}
        />
      ) : null}
    </span>
  );
}

export function FloorPlan({
  floor,
  label,
  options,
  reducedMotion,
  onActivate,
  focusUnit,
  onFocusHandled,
}: FloorPlanProps): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  const firstFitting = options.findIndex((option) => option.variant === 'fits');
  const entryIndex = firstFitting === -1 ? 0 : firstFitting;
  const current = Math.min(activeIndex, Math.max(0, options.length - 1));

  useEffect(() => {
    setActiveIndex(entryIndex);
  }, [entryIndex]);

  useEffect(() => {
    if (!focusUnit) return;
    const index = options.findIndex((option) => option.unitId === focusUnit);
    if (index >= 0) {
      setActiveIndex(index);
      refs.current[index]?.focus();
    }
    onFocusHandled?.();
  }, [focusUnit, onFocusHandled, options]);

  const move = (next: number): void => {
    if (options.length === 0) return;
    const wrapped = (next + options.length) % options.length;
    setActiveIndex(wrapped);
    refs.current[wrapped]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number): void => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        move(0);
        break;
      case 'End':
        event.preventDefault();
        move(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onActivate(options[index] as PlanOption);
        break;
      default:
        break;
    }
  };

  const byRoom = new Map<string, PlanOption[]>();
  for (const option of options) {
    const list = byRoom.get(option.roomId) ?? [];
    list.push(option);
    byRoom.set(option.roomId, list);
  }

  return (
    <div className="plan" role="listbox" aria-label={label}>
      {floor.rooms.map((room) => (
        <section className="plan-room" key={room.room_id} aria-label={room.name}>
          <h3 className="plan-room-name">{room.name}</h3>
          <div className="plan-room-tables">
            {(byRoom.get(room.room_id) ?? []).map((option) => {
              const index = options.indexOf(option);
              return (
                <div
                  key={option.unitId}
                  ref={(node) => {
                    refs.current[index] = node;
                  }}
                  role="option"
                  aria-label={option.accessibleName}
                  aria-selected={option.variant === 'held'}
                  aria-disabled={option.disabled ? true : undefined}
                  tabIndex={index === current ? 0 : -1}
                  className={`plan-table plan-table--${option.variant}`}
                  onClick={() => {
                    setActiveIndex(index);
                    onActivate(option);
                  }}
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                >
                  <TableFigure option={option} reducedMotion={reducedMotion} />
                  <span className="plan-table-id">{option.unitId}</span>
                  <span className="plan-table-status">{option.statusText}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
