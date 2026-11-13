import { useOnScreen, useReducedMotion } from './hooks';
import { Reveal } from './Reveal';

const NAMES = ['Northwind Kiln hero', 'Pell & Sorrel launch', 'Quiet Orbit pricing', 'Ferrous Lab intro', 'Tallow Street drop', 'Marrow FM teaser'] as const;

function Glyph({ index }: { index: number }) {
  const shapes = [
    <circle key="a" cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />,
    <path key="b" d="M3 14 9 3l6 11z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />,
    <rect key="c" x="3.5" y="3.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />,
    <path key="d" d="M3 9h12M9 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
    <path key="e" d="M3 12c2-8 4-8 6 0s4 8 6 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
    <path key="f" d="M9 2.5 15 9l-6 6.5L3 9z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />,
  ];
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      {shapes[index % shapes.length]}
    </svg>
  );
}

function Row({ hidden }: { hidden?: boolean }) {
  return (
    <ul className="marquee-row" aria-hidden={hidden ? 'true' : undefined}>
      {NAMES.map((name, index) => (
        <li key={name}>
          <Glyph index={index} />
          <span>{name}</span>
        </li>
      ))}
    </ul>
  );
}

export function PublishedMarquee() {
  const reduced = useReducedMotion();
  const [frameRef, onScreen] = useOnScreen<HTMLDivElement>();

  return (
    <Reveal className="marquee-panel" id="published-embeds" aria-label="Published embeds">
      <p className="marquee-caption muted">Published from Halation Studio</p>
      <div ref={frameRef} className="marquee-frame" data-paused={onScreen ? 'false' : 'true'} data-reduced={reduced ? 'true' : 'false'}>
        <div className="marquee-track">
          <Row />
          {!reduced && <Row hidden />}
        </div>
      </div>
    </Reveal>
  );
}
