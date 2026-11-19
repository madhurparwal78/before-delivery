import { useEffect } from 'react';
import type { ReturnJson } from '../../../shared/types';
import { dateLine, statusLabel } from '../lib/design';

interface Props {
  date: string;
  returns: ReturnJson[];
  nowISO: string;
  onClose: () => void;
}

const AXIS_START_HOUR = -6; // 6 pm the evening before, as hours from local midnight
const AXIS_END_HOUR = 30; // 6 am the morning after
const AXIS_HOURS = AXIS_END_HOUR - AXIS_START_HOUR; // 36

/**
 * The Midnight meridian: one 24-hour strip per return, placed by its state's
 * offset from Central at that deadline, on a 36-hour axis of Central hours.
 */
export function MeridianBand({ date, returns, nowISO, onClose }: Props): React.ReactNode {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const now = new Date(nowISO);
  const stateCodes = [...new Set(returns.map((r) => r.state))].sort();
  const ordered = returns.slice().sort(compareReturns);
  const nowOnAxis = nowOnTheAxis(now, date);

  return (
    <section
      className="meridian"
      role="region"
      aria-label={`Deadlines on ${dateLine(date)}`}
    >
      <div className="meridian-inner">
        <ul className="meridian-list" aria-label={`Deadlines on ${dateLine(date)}`}>
          {ordered.map((ret, index) => {
            const offset = ret.offset_hours;
            // The strip slides by its offset in the opposite direction, so
            // Eastern sits left of Central and Hawaii furthest right.
            const position = ((-offset - AXIS_START_HOUR) / AXIS_HOURS) * 100;
            const past = now.getTime() >= new Date(ret.due_at).getTime();
            return (
              <li
                key={ret.id}
                className={`meridian-strip strip-${chipIndex(stateCodes, ret.state)} ${past ? 'meridian-past' : ''} ${ret.overdue ? 'meridian-overdue' : ''}`}
                data-return-id={ret.id}
                data-status={ret.status}
                data-overdue={String(ret.overdue)}
                data-due-at={ret.due_at}
                data-state={ret.state}
                data-version={ret.version}
                data-rate={ret.edition.rate}
                data-edition={ret.edition.effective_date}
                data-offset-hours={offset}
                data-past={String(past)}
                style={{
                  left: `${position}%`,
                  animationDelay: reduced ? '0ms' : `${Math.min(index * 40, 400)}ms`,
                }}
              >
                <span className="meridian-copy">
                  {ret.client.name} {ret.state} · {ret.local_deadline_label} · {ret.practice_deadline_label}
                  {ret.overdue ? ' · Overdue' : ''}
                </span>
                {ret.carried_from !== null ? (
                  <span className="meridian-carried">Carried from {dateLine(ret.carried_from)}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="meridian-now" data-now={nowISO} style={{ display: nowOnAxis === null ? 'none' : 'block', left: nowOnAxis === null ? undefined : `${nowOnAxis}%` }} />
        <table aria-label="Deadlines" className="meridian-table">
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">Local deadline</th>
              <th scope="col">Practice deadline</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((ret) => (
              <tr key={ret.id}>
                <td>{ret.state}</td>
                <td>{ret.local_deadline_label}</td>
                <td>{ret.practice_deadline_label}</td>
                <td>{statusLabel(ret.status)}{ret.overdue ? ' · Overdue' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function nowOnTheAxis(now: Date, date: string): number | null {
  // Position of the practice's current instant on the axis, in percent.
  const axisStart = new Date(`${date}T00:00:00Z`).getTime() + AXIS_START_HOUR * 3600_000;
  const axisEnd = new Date(`${date}T00:00:00Z`).getTime() + AXIS_END_HOUR * 3600_000;
  const time = now.getTime();
  if (time < axisStart || time > axisEnd) return null;
  return ((time - axisStart) / (axisEnd - axisStart)) * 100;
}

function compareReturns(a: ReturnJson, b: ReturnJson): number {
  if (a.due_at !== b.due_at) return a.due_at < b.due_at ? -1 : 1;
  if (a.state !== b.state) return a.state < b.state ? -1 : 1;
  if (a.client.name !== b.client.name) return a.client.name < b.client.name ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

function chipIndex(stateCodes: string[], state: string): number {
  return Math.max(0, stateCodes.indexOf(state)) % 4;
}
