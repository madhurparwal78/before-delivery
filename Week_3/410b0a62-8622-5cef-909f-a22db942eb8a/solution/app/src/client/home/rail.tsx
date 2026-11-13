import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, ListPlus, Upload } from 'lucide-react';
import { COMPLIANCE_LABELS, tallyLine } from '../../shared/compliance.js';
import { dayLabel, mondayLabel } from '../../shared/dates.js';
import { formatTss, formatTsb, plainNumber } from '../../shared/format.js';
import type { CalendarDay, Item, WeekSummary } from '../../shared/types.js';
import { useReducedMotion, type Announcer } from '../hooks.js';
import { Link } from '../router.js';
import { Status } from '../ui.js';
import { TRACK_EASING, TRACK_MS } from '../motion.js';
import type { Calendar } from './calendar.js';

const SWIPE_MIN_PX = 40;

function CalendarItem({ item, calendar }: { item: Item; calendar: Calendar }) {
  const { planned, completed } = item;
  const shown = completed ?? (planned as NonNullable<typeof planned>);
  const movable = planned !== null && completed === null;
  const title = shown.title;
  const tss = completed ? completed.tss : (planned?.planned_tss ?? null);
  const attrs: Record<string, string | number> = {
    'data-compliance': item.compliance,
    'data-duration-s': shown.duration_s,
    'data-sport': shown.sport
  };
  if (planned?.planned_tss != null) attrs['data-planned-tss'] = formatTss(planned.planned_tss);
  if (completed?.tss != null) attrs['data-completed-tss'] = formatTss(completed.tss);
  if (tss !== null) attrs['data-tss'] = formatTss(tss);
  return (
    <li
      className={`item state-${item.compliance}${movable ? ' item-movable' : ''}${calendar.dragging === planned?.id ? ' item-dragging' : ''}`}
      {...attrs}
      onPointerDown={movable ? (event) => calendar.startDrag(event, planned) : undefined}
      onClickCapture={(event) => {
        if (calendar.consumeClickAfterDrag()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <Link to={`/workouts/${shown.id}`} className="item-title" draggable={false}>
        {title}
      </Link>
      {completed && planned && planned.title !== completed.title && (
        <Link to={`/workouts/${planned.id}`} className="item-plan" draggable={false}>
          {planned.title}
        </Link>
      )}
      <p className="item-meta">
        <span className="item-state">{COMPLIANCE_LABELS[item.compliance]}</span>
        {tss !== null && <span className="item-tss">{`${formatTss(tss)} TSS`}</span>}
      </p>
      {movable && (
        <button
          type="button"
          className="icon-button item-move"
          aria-label={`Move ${title}`}
          data-move-id={planned.id}
          onKeyDown={(event) => calendar.onKeyDown(event, { kind: 'move', workout: planned })}
        >
          <GripVertical aria-hidden="true" size={18} />
        </button>
      )}
    </li>
  );
}

interface ChipProps {
  day: CalendarDay;
  today: string;
  calendar: Calendar;
  onLog: (date: string) => void;
  onPlan: (date: string) => void;
}

function Chip({ day, today, calendar, onLog, onPlan }: ChipProps) {
  const label = dayLabel(day.date);
  const [weekday = '', ...rest] = label.split(' ');
  return (
    <div
      role="group"
      aria-label={label}
      data-date={day.date}
      className={`chip${day.date === today ? ' chip-today' : ''}${calendar.target === day.date ? ' chip-target' : ''}`}
    >
      <p className="chip-day">
        <span>{weekday}</span> <strong>{rest.join(' ')}</strong>
      </p>
      {day.items.length > 0 && (
        <ul className="chip-items">
          {day.items.map((item) => (
            <CalendarItem key={(item.planned ?? item.completed)?.id} item={item} calendar={calendar} />
          ))}
        </ul>
      )}
      <div className="chip-actions">
        <button type="button" className="chip-button" aria-label={`Log session on ${label}`} onClick={() => onLog(day.date)}>
          <Upload aria-hidden="true" size={18} />
          <span className="sr-only">Log</span>
        </button>
        <button type="button" className="chip-button" aria-label={`Plan on ${label}`} onClick={() => onPlan(day.date)}>
          <ListPlus aria-hidden="true" size={18} />
          <span className="sr-only">Plan</span>
        </button>
      </div>
    </div>
  );
}

interface TileProps extends Omit<ChipProps, 'day'> {
  week: WeekSummary;
  active: boolean;
}

function WeekTile({ week, active, ...chip }: TileProps) {
  const counts = Object.fromEntries(Object.entries(week.tally).map(([state, count]) => [`data-count-${state}`, count]));
  return (
    <div
      role="group"
      aria-label={`Week of ${mondayLabel(week.monday)}`}
      className="week-tile"
      data-week={week.week}
      data-active={active}
      data-planned-tss={formatTss(week.planned_tss)}
      data-completed-tss={formatTss(week.completed_tss)}
      data-tsb={plainNumber(week.tsb, 1)}
      {...counts}
    >
      <header className="week-head">
        <p className="eyebrow">{`Week of ${mondayLabel(week.monday)}`}</p>
        <div className="week-reveal">
          <div className="week-stats">
            <p className="week-stat">
              Planned <span className="num">{formatTss(week.planned_tss)}</span> TSS
            </p>
            <p className="week-stat">
              Completed <span className="num">{formatTss(week.completed_tss)}</span> TSS
            </p>
            <p className="week-stat">
              Form <span className="num">{formatTsb(week.tsb)}</span>
            </p>
          </div>
          <p className="tally">{tallyLine(week.tally)}</p>
        </div>
      </header>
      <div className="chips">
        {week.days.map((day) => (
          <Chip key={day.date} day={day} {...chip} />
        ))}
      </div>
    </div>
  );
}

export const weekAnnouncement = (week: WeekSummary): string =>
  `Week of ${mondayLabel(week.monday)}: planned ${formatTss(week.planned_tss)}, completed ${formatTss(week.completed_tss)}, form ${formatTsb(week.tsb)}`;

interface RailProps {
  weeks: WeekSummary[];
  centre: string;
  today: string;
  calendar: Calendar;
  weekStatus: Announcer;
  onCentre: (week: string) => void;
  onLoadEarlier: () => void;
  onLoadLater: () => void;
  onLog: (date: string) => void;
  onPlan: (date: string) => void;
  /** Placed in the controls row under the track (the library panel). */
  aside?: ReactNode;
  actions?: ReactNode;
}

export function Rail({ weeks, centre, today, calendar, weekStatus, onCentre, onLoadEarlier, onLoadLater, onLog, onPlan, aside, actions }: RailProps) {
  const reduced = useReducedMotion();
  const index = weeks.findIndex((week) => week.week === centre);
  const trackRef = useRef<HTMLDivElement>(null);
  const previous = useRef(index);
  const ticket = useRef(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = index;
    if (from === index || from < 0 || index < 0) return;
    setAdvanced(true);
    const track = trackRef.current;
    const tile = track?.firstElementChild as HTMLElement | null;
    if (reduced || !track || !tile) return;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const mine = ++ticket.current;
    const animation = track.animate([{ transform: `translateX(${(index - from) * (tile.offsetWidth + gap)}px)` }, { transform: 'translateX(0)' }], {
      duration: TRACK_MS,
      easing: TRACK_EASING
    });
    setMoving(true);
    const done = (): void => {
      if (ticket.current === mine) setMoving(false);
    };
    animation.finished.then(done, done);
  }, [index, reduced]);

  const go = (offset: number): void => {
    const target = weeks[index + offset];
    if (target) onCentre(target.week);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType !== 'mouse') swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(event.clientY - start.y)) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="rail-block">
      <section
        aria-label="Week rail"
        className="rail"
        tabIndex={0}
        data-week={centre}
        data-moving={moving}
        data-advanced={advanced || undefined}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            go(-1);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            go(1);
          }
        }}
      >
        <div
          className="rail-viewport"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            swipe.current = null;
          }}
        >
          <div className="rail-track" ref={trackRef} style={{ ['--index' as string]: Math.max(index, 0) }}>
            {weeks.map((week) => (
              <WeekTile key={week.week} week={week} active={week.week === centre} today={today} calendar={calendar} onLog={onLog} onPlan={onPlan} />
            ))}
          </div>
        </div>
      </section>
      <div className="rail-controls wrap">
        <div className="rail-nav">
          <button type="button" className="round-button" aria-label="Previous week" disabled={index <= 0} onClick={() => go(-1)}>
            <ChevronLeft aria-hidden="true" size={22} />
          </button>
          <div className="dots">
            {weeks.map((week) => (
              <button
                key={week.week}
                type="button"
                className="dot"
                aria-label={`Week of ${mondayLabel(week.monday)}`}
                aria-current={week.week === centre ? 'true' : undefined}
                onClick={() => onCentre(week.week)}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
          <button type="button" className="round-button" aria-label="Next week" disabled={index < 0 || index >= weeks.length - 1} onClick={() => go(1)}>
            <ChevronRight aria-hidden="true" size={22} />
          </button>
        </div>
        <div className="rail-extra">
          <div className="rail-load">
            <button type="button" className="text-button" onClick={onLoadEarlier}>
              Load earlier weeks
            </button>
            <button type="button" className="text-button" onClick={onLoadLater}>
              Load later weeks
            </button>
            {actions}
          </div>
          <Status label="Week announcements" announcer={weekStatus} className="sr-only" />
          <Status label="Calendar announcements" announcer={calendar.announcer} className="calendar-status" />
        </div>
        {aside}
      </div>
    </div>
  );
}
