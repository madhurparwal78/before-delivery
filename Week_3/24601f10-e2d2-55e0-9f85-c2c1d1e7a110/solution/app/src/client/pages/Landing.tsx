import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Fill, Format } from '../../shared/api.js';
import { FormatObject } from '../art/Objects.js';
import { Chrome, SignOut } from '../components/Chrome.js';
import { FORMAT_NAMES, FORMAT_OBJECT_NAMES, ORDERED_FORMATS } from '../format.js';
import { MOTION, reducedMotion, tween } from '../motion.js';
import { Link } from '../router.js';
import { useSession } from '../session.js';

const FACTS: Record<Format, string> = {
  single_elimination: 'One loss and you are out. Byes go to the top seeds.',
  double_elimination: 'Two losses to leave. Losers drop to a second bracket and meet the winners in a grand final.',
  round_robin: 'Everyone plays everyone once, and the table names the tiebreak that decided each place.',
  swiss: 'A fixed number of rounds. Nobody is knocked out, and each round pairs players on similar records.',
};

const TILE_FILL: Record<Format, Fill> = { single_elimination: 'lilac', double_elimination: 'lemon', round_robin: 'mint', swiss: 'lilac' };

export function Landing(): ReactNode {
  const { username } = useSession();
  const [format, setFormat] = useState<Format>('single_elimination');
  const tile = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  // Choosing a format closes shutter slats over the tile, swaps the object, and reopens them (about a third of a second).
  const choose = (next: Format): void => {
    if (next === format || busy.current) return;
    if (reducedMotion() || !tile.current) {
      setFormat(next);
      return;
    }
    busy.current = true;
    const el = tile.current;
    const half = MOTION.swap / 2;
    tween(half, (p) => el.style.setProperty('--cover', String(p)), () => {
      setFormat(next);
      tween(half, (p) => el.style.setProperty('--cover', String(1 - p)), () => { busy.current = false; });
    });
  };

  const onKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const at = ORDERED_FORMATS.indexOf(format);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = ORDERED_FORMATS[(at + step + ORDERED_FORMATS.length) % ORDERED_FORMATS.length] as Format;
    choose(next);
    tabs.current[ORDERED_FORMATS.indexOf(next)]?.focus();
  };

  const selected = ORDERED_FORMATS.indexOf(format);
  return (
    <Chrome bare>
      <div className="landing">
        <h1 className="wordmark">Cupfold</h1>
        <div className="landing-side">
          <p className="landing-description">A bracket desk for the one volunteer who runs a local cup.</p>
          <nav className="landing-links">
            {username ? (
              <>
                <Link to="/t" className="navlink">Your tournaments</Link>
                <SignOut />
              </>
            ) : (
              <>
                <Link to="/signin" className="navlink">Sign in</Link>
                <Link to="/signup" className="navlink">Create account</Link>
              </>
            )}
          </nav>
        </div>
        <div role="tablist" aria-label="Formats" className="format-tabs">
          {ORDERED_FORMATS.map((item, index) => (
            <button key={item} ref={(el) => { tabs.current[index] = el; }} role="tab" type="button" aria-selected={item === format}
              tabIndex={item === format ? 0 : -1} className="format-tab" data-distance={Math.abs(index - selected)}
              onClick={() => choose(item)} onKeyDown={onKey}>{FORMAT_NAMES[item]}</button>
          ))}
        </div>
        <div className="stage">
          <div ref={tile} className="tile" style={{ '--tile': `var(--${TILE_FILL[format]})` } as React.CSSProperties}>
            <div role="tabpanel" className="tile-panel">
              <FormatObject format={format} fill={TILE_FILL[format]} label={FORMAT_OBJECT_NAMES[format]} className="tile-object" />
            </div>
            <div className="slat-cover" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div>
          </div>
          <p className="fact">{FACTS[format]}</p>
          <Link to="/t/new" className="btn btn-cta">Start a tournament</Link>
        </div>
      </div>
    </Chrome>
  );
}
