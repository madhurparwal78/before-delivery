import { useEffect, useRef, type ReactNode } from 'react';
import { animate } from 'motion';
import { formatMoney } from '../../shared/money';
import { formatStoreDate } from '../../shared/time';
import type { Quote, Tier } from '../../shared/types';
import { prefersReducedMotion, SPEED, useReducedMotion } from '../lib/motion';
import { RollingMoney } from './figures';

const HANDLE = 44;
const OVERSHOOT = 5;

interface RailProps {
  quotes: Quote[];
  tiers: Tier[];
  termMonths: number;
  contractMonth: number;
  month: number;
  onMonth: (month: number) => void;
  onRelease: (month: number) => void;
  status: string;
}

function centreOf(month: number, termMonths: number, trackWidth: number): number {
  const first = HANDLE / 2;
  const last = Math.max(first, trackWidth - HANDLE / 2);
  return termMonths === 0 ? first : first + (month / termMonths) * (last - first);
}

export function BuyoutRail({
  quotes,
  tiers,
  termMonths,
  contractMonth,
  month,
  onMonth,
  onRelease,
  status,
}: RailProps): ReactNode {
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ pointerId: number; horizontal: boolean; x: number; y: number } | null>(null);
  const quote = quotes[month] ?? quotes[quotes.length - 1];

  const settle = (target: number, animated: boolean): void => {
    const trackElement = track.current;
    const handleElement = handle.current;
    if (trackElement === null || handleElement === null) return;
    const width = trackElement.clientWidth;
    const left = centreOf(target, termMonths, width) - HANDLE / 2;
    if (!animated || prefersReducedMotion()) {
      handleElement.style.left = `${left}px`;
      return;
    }
    const current = Number.parseFloat(handleElement.style.left || `${left}`);
    const direction = left >= current ? 1 : -1;
    void animate(
      handleElement,
      { left: [`${current}px`, `${left + direction * OVERSHOOT}px`, `${left}px`] },
      { duration: SPEED.long, times: [0, 0.45, 1], ease: 'easeOut' },
    );
  };

  useEffect(() => {
    if (dragging.current !== null) return;
    settle(month, true);
  }, [month, termMonths, reduced]);

  useEffect(() => {
    const resize = (): void => settle(month, false);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [month, termMonths]);

  const monthAt = (clientX: number): number => {
    const trackElement = track.current;
    if (trackElement === null) return month;
    const box = trackElement.getBoundingClientRect();
    const first = HANDLE / 2;
    const last = Math.max(first + 1, box.width - HANDLE / 2);
    const ratio = (clientX - box.left - first) / (last - first);
    return Math.max(0, Math.min(termMonths, Math.round(ratio * termMonths)));
  };

  const keyStep = (event: React.KeyboardEvent): void => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -12,
      PageUp: 12,
    };
    let next: number | null = null;
    if (event.key in steps) next = month + (steps[event.key] ?? 0);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = termMonths;
    if (next === null) return;
    event.preventDefault();
    const clamped = Math.max(0, Math.min(termMonths, next));
    onMonth(clamped);
    onRelease(clamped);
  };

  const valueText =
    quote === undefined
      ? ''
      : `Month ${month} of ${termMonths}: equity ${formatMoney(quote.equity_cents)}, ${quote.tier.label}, payoff ${formatMoney(
          quote.payoff_cents,
        )}`;

  const sliderAria = {
    'aria-valuemin': 0,
    'aria-valuemax': termMonths,
    'aria-valuenow': month,
    'aria-valuetext': valueText,
  } as const;

  const span = Math.max(1, termMonths);
  const bands = tiers.map((tier) => {
    const to = tier.to_month === null ? termMonths : Math.min(tier.to_month, termMonths);
    return {
      tier,
      left: (tier.from_month / span) * 100,
      width: ((to - tier.from_month + 1) / span) * 100,
    };
  });

  return (
    <section className="rail-region" aria-label="Buyout rail">
      <h2>Buyout rail</h2>
      <div className="rail-figures">
        <span>
          <span className="label">Equity </span>
          {quote === undefined ? null : <RollingMoney cents={quote.equity_cents} className="brass figure" />}
        </span>
        <span>
          <span className="label">Payoff </span>
          {quote === undefined ? null : <RollingMoney cents={quote.payoff_cents} />}
        </span>
        <span className="tier-now">{quote?.tier.label}</span>
      </div>

      <div className={reduced ? 'rail-body reduced' : 'rail-body'}>
        <div>
      {reduced ? (
        <input
          type="range"
          className="rail-plain"
          aria-label="Buyout month"
          min={0}
          max={termMonths}
          step={1}
          value={month}
          {...sliderAria}
          onChange={(event) => {
            const next = Number(event.target.value);
            onMonth(next);
            onRelease(next);
          }}
          onKeyDown={(event) => {
            if (event.key === 'PageUp' || event.key === 'PageDown' || event.key === 'Home' || event.key === 'End') {
              keyStep(event);
            }
          }}
        />
      ) : (
        <div
          className="rail-track"
          ref={track}
          onPointerDown={(event) => {
            const horizontal = event.pointerType !== 'touch';
            dragging.current = { pointerId: event.pointerId, horizontal, x: event.clientX, y: event.clientY };
            if (horizontal) {
              const next = monthAt(event.clientX);
              onMonth(next);
              handle.current?.focus();
            }
          }}
          onPointerMove={(event) => {
            const state = dragging.current;
            if (state === null) return;
            if (!state.horizontal) {
              const dx = Math.abs(event.clientX - state.x);
              const dy = Math.abs(event.clientY - state.y);
              if (dx < 8 && dy < 8) return;
              if (dy > dx) {
                dragging.current = null;
                return;
              }
              state.horizontal = true;
            }
            const handleElement = handle.current;
            const trackElement = track.current;
            if (handleElement !== null && trackElement !== null) {
              const box = trackElement.getBoundingClientRect();
              const left = Math.max(0, Math.min(box.width - HANDLE, event.clientX - box.left - HANDLE / 2));
              handleElement.style.left = `${left}px`;
            }
            onMonth(monthAt(event.clientX));
          }}
          onPointerUp={(event) => {
            const state = dragging.current;
            dragging.current = null;
            if (state === null) return;
            const moved = Math.abs(event.clientX - state.x) >= 8 || Math.abs(event.clientY - state.y) >= 8;
            const next = state.horizontal || !moved ? monthAt(event.clientX) : month;
            onMonth(next);
            settle(next, true);
            onRelease(next);
          }}
          onPointerCancel={() => {
            dragging.current = null;
            settle(month, true);
          }}
          onClick={(event) => {
            if (dragging.current !== null) return;
            const next = monthAt(event.clientX);
            if (next === month) return;
            onMonth(next);
            settle(next, true);
            onRelease(next);
          }}
        >
          <div className="rail-bands" aria-hidden="true">
            {bands.map(({ tier, left, width }) => (
              <div className="tier-band" key={tier.name} style={{ left: `${left}%`, width: `${width}%` }}>
                <span className="tier-band-label">{tier.name}</span>
              </div>
            ))}
          </div>
          <div className="rail-notches" aria-hidden="true">
            {quotes.map((entry) => (
              <span
                key={entry.month}
                className={`rail-notch ${entry.month <= contractMonth ? 'paid' : 'future'}`}
                style={{ left: `calc(${(entry.month / Math.max(1, termMonths)) * 100}% - 0.5px)` }}
              />
            ))}
            {tiers
              .filter((tier) => tier.from_month > 0)
              .map((tier) => (
                <span
                  key={`boundary-${tier.from_month}`}
                  className="rail-boundary"
                  style={{ left: `${(tier.from_month / Math.max(1, termMonths)) * 100}%` }}
                />
              ))}
          </div>
          <div
            className="rail-handle"
            ref={handle}
            role="slider"
            aria-label="Buyout month"
            tabIndex={0}
            onKeyDown={keyStep}
            {...sliderAria}
          >
            <span aria-hidden="true">{month}</span>
          </div>
        </div>
      )}

        <p className="status" role="status" aria-label="Payoff quote">
          {status}
        </p>
        </div>

      {reduced ? (
        <div className="schedule-table">
          <table>
            <caption>Buyout schedule</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Equity</th>
                <th scope="col">Tier</th>
                <th scope="col">Payoff</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((entry) => (
                <tr key={entry.month}>
                  <td className="figure">{`${entry.month}${entry.month === contractMonth ? ' (now)' : ''}`}</td>
                  <td className="figure brass">{formatMoney(entry.equity_cents)}</td>
                  <td>{entry.tier.label}</td>
                  <td className="figure">{formatMoney(entry.payoff_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      </div>
    </section>
  );
}

export function railAnnouncement(month: number, quote: Quote | undefined): string {
  if (quote === undefined) return '';
  return `Month ${month} payoff ${formatMoney(quote.payoff_cents)}. Quote valid until ${formatStoreDate(
    quote.valid_until,
  )}.`;
}
