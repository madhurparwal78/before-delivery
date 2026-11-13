import { useEffect, useRef, useState, type ReactNode } from 'react';
import { emptyTally, onTargetPercent, tallyLine } from '../../shared/compliance.js';
import { daysBetween, dayLabel, longDayLabel } from '../../shared/dates.js';
import { formatDuration, formatPace, formatTsb, formatTss, formatWhole, parsePace, pluralise, plainNumber } from '../../shared/format.js';
import type { AthleteDetail, LibraryItem, SeriesDay, Threshold, ThresholdKind, ThresholdResult, WeekSummary } from '../../shared/types.js';
import { thresholdInForce } from '../../shared/thresholds.js';
import { failureMessage, fieldErrors, post } from '../api.js';
import { useAnnouncer, useReducedMotion } from '../hooks.js';
import { EmptyMark, Field, focusFirstInvalid, Pill, Status } from '../ui.js';
import type { Calendar } from './calendar.js';

const WALL_ROW_MIN = 5;
const ENTRANCE_MS = 400;
const ENTRANCE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/**
 * Fades its children up a short distance, once, when about a fifth of them comes into view from below.
 * Content is fully visible until then, so nothing is ever hidden; static when motion is reduced.
 */
function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (reduced || !element || typeof IntersectionObserver === 'undefined') return undefined;
    if (element.getBoundingClientRect().top < window.innerHeight * 0.8) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        element.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: ENTRANCE_MS, easing: ENTRANCE_EASING });
        observer.disconnect();
      },
      { threshold: 0.2 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <div ref={ref} className={className || undefined}>
      {children}
    </div>
  );
}

interface BannerProps {
  name: string | null;
  series: SeriesDay[];
  onPlan: () => void;
  onLog: () => void;
}

export function TodayBanner({ name, series, onPlan, onLog }: BannerProps) {
  const today = series[series.length - 1];
  const before = series[series.length - 2] ?? today;
  const tsb = today?.tsb ?? 0;
  const ctl = before?.ctl ?? 0;
  const atl = before?.atl ?? 0;
  const attrs = { 'data-tsb': plainNumber(tsb, 1), 'data-ctl': plainNumber(ctl, 1), 'data-atl': plainNumber(atl, 1) };
  return (
    <section aria-label="Today" className="today-band" {...attrs}>
      <svg className="band-art" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <polygon points="640,0 1000,0 1000,290 520,290" className="band-parallelogram" />
        <g className="band-outlines">
          <polygon points="40,60 300,60 240,420 -20,420" />
          <polygon points="260,110 540,110 480,470 200,470" />
          <polygon points="760,160 1000,160 950,500 710,500" />
        </g>
      </svg>
      <div className="wrap band-content">
        {name && <p className="band-eyebrow">{name}</p>}
        <h1 className="band-form" data-tsb={attrs['data-tsb']}>{`Form ${formatTsb(tsb)}.`}</h1>
        <p className="band-line" data-ctl={attrs['data-ctl']} data-atl={attrs['data-atl']}>
          {`Fitness ${plainNumber(ctl, 1)} · fatigue ${plainNumber(atl, 1)} coming into today`}
        </p>
        <div className="band-actions">
          <Pill tone="navy" onClick={onPlan}>
            Plan a workout
          </Pill>
          <Pill tone="navy" onClick={onLog}>
            Log a session
          </Pill>
        </div>
      </div>
    </section>
  );
}

export function SportTiles({ week }: { week: WeekSummary }) {
  const { sports } = week;
  const tiles: { label: string; value: string; raw: string }[] = [
    { label: 'Bike stress', value: formatTss(sports.bike_tss), raw: plainNumber(sports.bike_tss, 1) },
    { label: 'Run stress', value: formatTss(sports.run_tss), raw: plainNumber(sports.run_tss, 1) },
    { label: 'Bike time', value: formatDuration(sports.bike_s), raw: String(sports.bike_s) },
    { label: 'Run time', value: formatDuration(sports.run_s), raw: String(sports.run_s) },
    { label: 'Sessions', value: String(sports.sessions), raw: String(sports.sessions) }
  ];
  return (
    <section className="wrap section" aria-label="This week in numbers">
      <Reveal>
        <h2 className="section-title">This week in numbers</h2>
      </Reveal>
      <div className="sport-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} role="group" aria-label={tile.label} className="tile sport-tile" data-value={tile.raw}>
            <p className="tile-label">{tile.label}</p>
            <p className="tile-value">{tile.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Ring({ percent }: { percent: number | null }) {
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="ring">
      <div className="ring-glow" aria-hidden="true" />
      <svg viewBox="0 0 160 160" width="160" height="160" aria-hidden="true" focusable="false">
        <circle cx="80" cy="80" r={radius} className="ring-track" />
        {percent !== null && percent > 0 && (
          <circle cx="80" cy="80" r={radius} className="ring-arc" strokeDasharray={`${(circumference * percent) / 100} ${circumference}`} transform="rotate(-90 80 80)" />
        )}
      </svg>
      <p className="ring-value">{percent === null ? '—' : `${formatWhole(percent)}%`}</p>
    </div>
  );
}

export function ComplianceRings({ weeks }: { weeks: WeekSummary[] }) {
  const rows = [
    { label: 'This week', count: 1, note: 'The share of planned sessions you hit this week.' },
    { label: 'Last 4 weeks', count: 4, note: 'The four weeks ending with the centred week.' },
    { label: 'Last 12 weeks', count: 12, note: 'The twelve weeks ending with the centred week.' }
  ];
  return (
    <section className="wrap section" aria-label="Compliance">
      <Reveal>
        <h2 className="section-title">Compliance</h2>
      </Reveal>
      {rows.map((row, index) => {
        const window = weeks.slice(-row.count);
        const percent = onTargetPercent(window.map((week) => week.tally));
        const tally = window.reduce((sum, week) => {
          for (const state of Object.keys(sum) as (keyof typeof sum)[]) sum[state] += week.tally[state];
          return sum;
        }, emptyTally());
        return (
          <Reveal key={row.label} className={index % 2 === 1 ? 'ring-row ring-row-flip' : 'ring-row'}>
            <div role="group" aria-label={row.label} className="ring-group" {...(percent === null ? {} : { 'data-percent': formatWhole(percent) })}>
              <Ring percent={percent} />
              <div className="ring-text">
                <h3>{row.label}</h3>
                <p className="ring-line">{percent === null ? 'No planned sessions' : `${formatWhole(percent)}% on target`}</p>
                <p className="muted">{row.note}</p>
                <p className="ring-tally">{tallyLine(tally)}</p>
              </div>
            </div>
          </Reveal>
        );
      })}
    </section>
  );
}

export function UploadsWall({ recent }: { recent: { title: string; date: string; tss: number }[] }) {
  const reduced = useReducedMotion();
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = section.current;
    if (!element) return undefined;
    if (reduced) {
      element.style.setProperty('--drift', '0');
      return undefined;
    }
    const update = (): void => {
      const box = element.getBoundingClientRect();
      const progress = Math.min(Math.max((window.innerHeight - box.top) / (window.innerHeight + box.height), 0), 1);
      element.style.setProperty('--drift', String(progress - 0.5));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [reduced]);

  const rows = [recent.filter((_, index) => index % 2 === 0), recent.filter((_, index) => index % 2 === 1)];

  return (
    <section aria-label="Recent uploads" className="uploads" ref={section}>
      <div className="wrap">
        <h2 className="section-title">Recent uploads</h2>
      </div>
      {recent.length === 0 ? (
        <div className="empty empty-inline">
          <EmptyMark kind="wall" />
          <p className="empty-line">No sessions yet</p>
        </div>
      ) : (
        <div className="wall">
          {rows.map((row, index) => (
            <ul key={index} className={`wall-row wall-row-${index + 1}${row.length < WALL_ROW_MIN ? ' wall-row-short' : ''}`}>
              {row.map((tile) => (
                <li key={`${tile.date}-${tile.title}-${tile.tss}`} className="wall-tile">{`${tile.title} · ${dayLabel(tile.date)} · ${formatTss(tile.tss)} TSS`}</li>
              ))}
            </ul>
          ))}
        </div>
      )}
    </section>
  );
}

export function CountdownBand({ today, events }: { today: string; events: AthleteDetail['events'] }) {
  const next = events.filter((event) => event.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const days = next ? daysBetween(today, next.date) : null;
  const text = !next || days === null ? 'No event on the calendar' : days === 0 ? `Race day: ${next.name}` : days === 1 ? `1 day to ${next.name}` : `${days} days to ${next.name}`;
  return (
    <section aria-label="Next event" className="countdown" {...(days === null ? {} : { 'data-days': days })}>
      <div className="countdown-road" aria-hidden="true">
        <span className="road-start" />
        <span className={next ? 'road-line' : 'road-line road-line-dashed'} />
        <svg className="road-flag" viewBox="0 0 28 36" width="28" height="36" focusable="false">
          <path d="M4 34V3" className="road-pole" />
          <path d="M4 4h20l-6 7 6 7H4z" className={next ? 'road-cloth' : 'road-cloth road-cloth-empty'} />
        </svg>
      </div>
      <div className="wrap countdown-content">
        {!next && <EmptyMark kind="event" />}
        <p className="countdown-text">{text}</p>
      </div>
    </section>
  );
}

interface LibraryProps {
  items: LibraryItem[];
  calendar: Calendar;
}

export function LibraryPanel({ items, calendar }: LibraryProps) {
  return (
    <section aria-label="Workout library" className="tile library">
      <h2 className="tile-title">Workout library</h2>
      {items.length === 0 ? (
        <p className="muted">Workouts you save from the builder wait here until you place them on a day.</p>
      ) : (
        <ul className="library-list">
          {items.map((item) => (
            <li key={item.id} className="library-item">
              <span className="library-text">{`${item.name} · ${formatDuration(item.duration_s)} · ${formatTss(item.planned_tss)} TSS`}</span>
              <button
                type="button"
                className="pill pill-ghost pill-compact"
                aria-label={`Place ${item.name}`}
                data-place-id={item.id}
                onKeyDown={(event) => calendar.onKeyDown(event, { kind: 'place', item })}
              >
                Place
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const inForce = (history: Threshold[], kind: ThresholdKind, today: string): string => {
  const entry = thresholdInForce(history, kind, today);
  return entry ? (kind === 'ftp' ? String(entry.value) : formatPace(entry.value)) : '';
};

const thresholdLine = (entry: Threshold): string =>
  entry.kind === 'ftp' ? `FTP ${entry.value} W from ${longDayLabel(entry.effective_from)}` : `Threshold pace ${formatPace(entry.value)} /km from ${longDayLabel(entry.effective_from)}`;

export function ThresholdsPanel({ athleteId, today, history, onSaved }: { athleteId: string; today: string; history: Threshold[]; onSaved: () => void }) {
  const [ftp, setFtp] = useState('');
  const [pace, setPace] = useState('');
  const [from, setFrom] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const status = useAnnouncer();
  const region = useRef<HTMLElement>(null);

  useEffect(() => focusFirstInvalid(region.current, ['ftp', 'pace', 'from'], errors), [errors]);

  const save = async (): Promise<void> => {
    setPending(true);
    setErrors({});
    status.say('Saving…');
    const requests: { kind: ThresholdKind; value: number | null }[] = [];
    if (ftp.trim() !== '') requests.push({ kind: 'ftp', value: /^\d+$/.test(ftp.trim()) ? Number(ftp) : null });
    if (pace.trim() !== '') requests.push({ kind: 'pace', value: parsePace(pace) });
    if (requests.length === 0) requests.push({ kind: 'ftp', value: null });
    const done: string[] = [];
    const problems: Record<string, string> = {};
    for (const request of requests) {
      try {
        const result = await post<ThresholdResult>(`/api/athletes/${athleteId}/thresholds`, { kind: request.kind, value: request.value, effective_from: from });
        const label = request.kind === 'ftp' ? `FTP ${result.threshold.value} W` : `Threshold pace ${formatPace(result.threshold.value)} /km`;
        done.push(`${label} from ${longDayLabel(result.threshold.effective_from)}. Re-scored ${result.rescored} ${pluralise(result.rescored, 'workout')}.`);
      } catch (failure) {
        const fields = fieldErrors(failure);
        if (fields?.['value']) problems[request.kind === 'ftp' ? 'ftp' : 'pace'] = fields['value'];
        if (fields?.['effective_from']) problems['from'] = fields['effective_from'];
        if (!fields) problems['from'] = failureMessage(failure);
      }
    }
    setErrors(problems);
    status.say(done.join(' '));
    if (done.length > 0) {
      onSaved();
      if (!problems['ftp']) setFtp('');
      if (!problems['pace']) setPace('');
    }
    setPending(false);
  };

  return (
    <section aria-label="Thresholds" className="wrap section" ref={region}>
      <div className="tile thresholds">
        <h2 className="tile-title">Thresholds</h2>
        <form
          className="threshold-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label="FTP" error={errors['ftp']} hint="Watts">
            {(props) => <input {...props} data-field="ftp" type="text" inputMode="numeric" placeholder={inForce(history, 'ftp', today)} value={ftp} onChange={(event) => setFtp(event.target.value)} />}
          </Field>
          <Field label="Threshold pace" error={errors['pace']} hint="Minutes and seconds per km">
            {(props) => <input {...props} data-field="pace" type="text" placeholder={inForce(history, 'pace', today)} value={pace} onChange={(event) => setPace(event.target.value)} />}
          </Field>
          <Field label="Effective from" error={errors['from']} hint="YYYY-MM-DD">
            {(props) => <input {...props} data-field="from" type="text" inputMode="numeric" value={from} onChange={(event) => setFrom(event.target.value)} />}
          </Field>
          <Pill tone="navy" type="submit" pending={pending} pendingText="Saving…">
            Save threshold
          </Pill>
        </form>
        <Status label="Threshold status" announcer={status} className="threshold-status" />
        <ul className="threshold-history">
          {[...history]
            .sort((a, b) => (a.effective_from === b.effective_from ? (a.kind < b.kind ? -1 : 1) : a.effective_from < b.effective_from ? 1 : -1))
            .map((entry) => (
              <li key={`${entry.kind}-${entry.effective_from}`}>{thresholdLine(entry)}</li>
            ))}
        </ul>
      </div>
    </section>
  );
}
