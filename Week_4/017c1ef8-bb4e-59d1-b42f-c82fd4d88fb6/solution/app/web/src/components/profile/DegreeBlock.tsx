import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DegreeValue, Profile } from '../../types';
import { DEGREE_LABELS } from '../degree';
import { MUTUAL_FROM_MS, MUTUAL_MS, ROLL_EASING, ROLL_MS, prefersReducedMotion } from './motion';

const GLYPHS: Record<DegreeValue, string> = { '1': '1', '2': '2', '3': '3', out: '—' };

/** What the mutual line reads; empty when the viewer and the member share no connection. */
function mutualText(mutual: Profile['mutual']): string {
  if (!mutual || mutual.count === 0) return '';
  if (mutual.count === 1 || !mutual.named) return '1 mutual connection';
  const others = mutual.count - 1;
  return `${mutual.named.name} and ${others} other mutual connection${others === 1 ? '' : 's'}`;
}

/**
 * The degree numeral in its fixed slot. When the degree changes, the old glyph moves up out of the slot and the new one
 * rises in from below over the roll duration; nothing shows outside the slot. Reduced motion swaps in the first frame.
 */
export function Numeral({ degree }: { degree: DegreeValue }) {
  const glyph = GLYPHS[degree];
  const [shown, setShown] = useState<{ degree: DegreeValue; leaving: string | null }>({ degree, leaving: null });
  if (shown.degree !== degree) setShown({ degree, leaving: prefersReducedMotion() ? null : GLYPHS[shown.degree] });
  const entering = useRef<HTMLSpanElement>(null);
  const leaving = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (shown.leaving === null) return undefined;
    const timing = { duration: ROLL_MS, easing: ROLL_EASING };
    entering.current?.animate([{ transform: 'translateY(140%)' }, { transform: 'translateY(0)' }], timing);
    leaving.current?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-140%)' }], timing);
    const done = (): void => setShown((current) => (current.leaving === null ? current : { ...current, leaving: null }));
    const timer = window.setTimeout(done, ROLL_MS);
    void entering.current?.getAnimations()[0]?.finished.then(done, () => undefined);
    return () => window.clearTimeout(timer);
  }, [shown.degree, shown.leaving]);

  return (
    <div className="pf-numeral" data-degree-roll data-degree={degree} aria-hidden="true">
      {shown.leaving === null ? null : (
        <span ref={leaving} key={`out-${shown.leaving}`} className="pf-glyph pf-glyph-leaving">
          {shown.leaving}
        </span>
      )}
      <span ref={entering} key={glyph} className="pf-glyph">
        {glyph}
      </span>
    </div>
  );
}

export function DegreeLabel({ degree }: { degree: DegreeValue }) {
  return (
    <p className="pf-degree-label" data-degree-badge data-degree={degree}>
      {DEGREE_LABELS[degree]}
    </p>
  );
}

/** The mutual line: a link to the list. Its text rolls (the count with it) between 280 and 600 ms after a change. */
export function MutualLine({ handle, mutual }: { handle: string; mutual: Profile['mutual'] }) {
  const text = mutualText(mutual);
  const [shown, setShown] = useState<{ text: string; leaving: string | null }>({ text, leaving: null });
  if (shown.text !== text) setShown({ text, leaving: text !== '' && shown.text !== '' && !prefersReducedMotion() ? shown.text : null });
  const entering = useRef<HTMLSpanElement>(null);
  const leaving = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (shown.leaving === null) return undefined;
    const timing = { duration: MUTUAL_MS, delay: MUTUAL_FROM_MS, easing: ROLL_EASING, fill: 'both' as const };
    entering.current?.animate([{ transform: 'translateY(140%)' }, { transform: 'translateY(0)' }], timing);
    leaving.current?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-140%)' }], timing);
    const done = (): void => setShown((current) => (current.leaving === null ? current : { ...current, leaving: null }));
    const timer = window.setTimeout(done, MUTUAL_FROM_MS + MUTUAL_MS);
    return () => window.clearTimeout(timer);
  }, [shown.text, shown.leaving]);

  if (text === '' || !mutual) return null;
  return (
    <Link to={`/in/${handle}/mutual`} className="pf-mutual t-larger" data-mutual-line data-count={mutual.count}>
      {shown.leaving === null ? null : (
        <span ref={leaving} key={`out-${shown.leaving}`} className="pf-mutual-text pf-mutual-leaving" aria-hidden="true">
          {shown.leaving}
        </span>
      )}
      <span ref={entering} key={text} className="pf-mutual-text">
        {text}
      </span>
    </Link>
  );
}
