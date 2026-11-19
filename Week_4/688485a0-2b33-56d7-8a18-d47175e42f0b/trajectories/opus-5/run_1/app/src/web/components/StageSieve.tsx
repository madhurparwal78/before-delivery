import { useEffect, useRef, useState } from 'react';
import { displayNumber } from '../../shared/numbers';
import { PASS_THROUGH, PIN_REACHES_END, PIN_STOPS_HERE, stageStatusText } from '../copy';

export const BAND_STAGGER = 40;
export const BAND_DURATION = 320;

/** The published bar geometry: the log ratio of a band's output to the pipeline input. */
export function barRatio(out: number, input: number): number {
  if (input === 0) return 0;
  return Math.min(1, Math.log(1 + out) / Math.log(1 + input));
}

function useSettling(
  target: number,
  ratio: number,
  delay: number,
  animate: boolean,
): { count: number; ratio: number } {
  const [shown, setShown] = useState(() => (animate ? { count: 0, ratio: 0 } : { count: target, ratio }));
  const current = useRef(shown);
  current.current = shown;

  useEffect(() => {
    if (!animate) {
      setShown({ count: target, ratio });
      return;
    }
    const from = current.current;
    const begin = performance.now() + delay;
    let frame = 0;
    const tick = (now: number): void => {
      const progress = Math.min(Math.max((now - begin) / BAND_DURATION, 0), 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown({
        count: Math.round(from.count + (target - from.count) * eased),
        ratio: from.ratio + (ratio - from.ratio) * eased,
      });
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ratio, delay, animate]);

  return shown;
}

export interface BandData {
  index: number;
  label: string;
  count: number;
  disabled: boolean;
  capped: boolean;
  invalid?: boolean;
}

/** One Stage Sieve band: track, lime bar, overflow notch, label and tabular numeral. */
export function SieveBand({
  band,
  total,
  input,
  limit,
  animateFrom,
  reduced,
  pin,
}: {
  band: BandData;
  total: number;
  input: number;
  limit: number;
  animateFrom: number;
  reduced: boolean;
  pin: 'stop' | 'end' | null;
}): JSX.Element {
  const out = band.capped ? limit : band.count;
  const ratio = barRatio(out, input);
  const animate = !reduced && band.index >= animateFrom;
  const delay = animate ? BAND_STAGGER * (band.index - animateFrom) : 0;
  const settling = useSettling(out, ratio, delay, animate);
  const overflow = out > input;
  const statusText = band.invalid
    ? 'not valid JSON'
    : band.disabled
      ? PASS_THROUGH
      : stageStatusText(band.index + 1, total, band.count, band.capped, limit);

  return (
    <div className="band-area">
      <div className="band-row">
        <span className="stage-count count">{displayNumber(settling.count)}</span>
      </div>
      {band.disabled ? (
        <div className="band disabled" data-sieve-track="true">
          <span role="status">{statusText}</span>
        </div>
      ) : (
        <div className="band" data-sieve-track="true">
          <div
            className="band-bar"
            data-sieve-bar="true"
            data-overflow={overflow ? 'true' : 'false'}
            style={{ width: `${(overflow ? 1 : settling.ratio) * 100}%` }}
          />
          {overflow ? <span className="band-notch" aria-hidden="true" /> : null}
        </div>
      )}
      {pin ? (
        <span
          className="pin-marker"
          data-pin-marker="true"
          data-stop-index={pin === 'end' ? 'end' : String(band.index)}
          aria-hidden="true"
        />
      ) : null}
      {band.disabled ? null : <div role="status">{statusText}</div>}
      {pin ? <div className="pin-label">{pin === 'end' ? PIN_REACHES_END : PIN_STOPS_HERE}</div> : null}
    </div>
  );
}
