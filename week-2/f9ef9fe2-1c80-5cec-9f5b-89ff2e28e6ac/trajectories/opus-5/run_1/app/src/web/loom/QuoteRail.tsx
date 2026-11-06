import type { ReactNode } from 'react';
import type { Quote } from '../../shared/types';
import { formatAmount, formatHours } from '../../shared/format';
import { useCountingCents } from '../hooks';

export interface RailProps {
  quote: Quote | null;
  pricing: boolean;
  pricingFailed: boolean;
  announcement: string;
  usePack: boolean;
  onUsePack: (value: boolean) => void;
  packQuartersLeft: number;
  canUsePack: boolean;
  holdSecondsLeft: number | null;
  holdSeconds: number;
  heldUntil: string | null;
  reducedMotion: boolean;
  hasBrush: boolean;
  placing: boolean;
  onPlaceHold: () => void;
  onClearBrush: () => void;
  onConfirm: () => void;
  onRelease: () => void;
  onRepeatWeekly: () => void;
  confirmDisabled: boolean;
  repeatDisabled: boolean;
  repeatHint: string | null;
}

export function QuoteRail(props: RailProps): ReactNode {
  const totalCents = props.quote ? props.quote.total_cents : 0;
  const shown = useCountingCents(totalCents, props.reducedMotion);
  const held = props.holdSecondsLeft !== null && props.holdSecondsLeft > 0;

  return (
    <>
      <div role="group" aria-label="Quote total">
        <h3>Quote</h3>
        <div className="quote-total">${formatAmount(shown)}</div>
        {props.pricing && <p className="quote-sub">Pricing…</p>}
        {!props.pricing && props.pricingFailed && (
          <p className="quote-sub" style={{ color: 'var(--coral)' }}>
            Pricing unavailable. Try again.
          </p>
        )}
        {!props.pricing && !props.pricingFailed && props.quote && (
          <p className="quote-sub num">
            {props.quote.hours} hours · {props.quote.quarters} quarter hours
          </p>
        )}
      </div>

      <ul className="quote-lines" aria-label="Quote lines">
        {(props.quote ? props.quote.lines : []).map((line, index) => (
          <li key={`${line.station_id}-${line.tier}-${line.paid_by}-${index}`}>
            <span>
              {line.station} · tier {line.tier} · {line.hours} h
            </span>
            <span className="amt">
              {line.paid_by === 'pack' ? 'pack' : `$${formatAmount(line.amount_cents)}`}
            </span>
          </li>
        ))}
      </ul>

      {props.quote &&
        props.quote.tier_steps_crossed.map((tier) => (
          <p className="tier-step" key={tier}>
            Crosses into tier {tier}
          </p>
        ))}

      <div role="status" aria-label="Quote announcement" className="sr-only">
        {props.announcement}
      </div>

      <label className="checkrow">
        <input
          type="checkbox"
          checked={props.usePack}
          disabled={!props.canUsePack}
          onChange={(event) => props.onUsePack(event.target.checked)}
        />
        <span>Use pack hours ({formatHours(props.packQuartersLeft)} h left)</span>
      </label>

      {held && (
        <div>
          {!props.reducedMotion && (
            <div
              className="hold-progress"
              role="progressbar"
              aria-label="Hold time left"
              aria-valuemin={0}
              aria-valuemax={props.holdSeconds}
              aria-valuenow={props.holdSecondsLeft ?? 0}
            >
              <span
                style={{
                  width: `${Math.max(0, Math.min(100, ((props.holdSecondsLeft ?? 0) / props.holdSeconds) * 100))}%`,
                  transition: 'width 1s linear',
                }}
              />
            </div>
          )}
          {props.heldUntil !== null && (
            <p className="held-until">held until {props.heldUntil}</p>
          )}
        </div>
      )}

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={props.onPlaceHold}
          disabled={!props.hasBrush || props.placing}
        >
          Place hold
        </button>
        <button type="button" onClick={props.onClearBrush} disabled={!props.hasBrush}>
          Clear brush
        </button>
        <button
          type="button"
          className="primary"
          onClick={props.onConfirm}
          disabled={!held || props.confirmDisabled}
        >
          Confirm booking
        </button>
        <button type="button" onClick={props.onRelease} disabled={!held}>
          Release hold
        </button>
        <button
          type="button"
          onClick={props.onRepeatWeekly}
          disabled={props.repeatDisabled}
          title={props.repeatHint ?? undefined}
        >
          Repeat weekly
        </button>
      </div>
    </>
  );
}
