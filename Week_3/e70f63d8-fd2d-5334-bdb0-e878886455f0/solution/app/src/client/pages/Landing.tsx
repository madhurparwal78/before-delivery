import type { JSX } from 'preact';
import { Link } from '../lib/router.js';
import { userStore } from '../lib/user.js';

const GROUND = '#0E0B1A';
const SURFACE = '#1E1A3C';
const KEY = '#34305A';
const INK = '#F0EBFF';
const LIME = '#C6FF3D';
const BAND = '#4A1FE0';
const BAND_DEEP = '#3A15B8';

/** A mown pitch seen from above: mowing bands, creases, stumps and the trail of a ball. */
const PitchStrip = (): JSX.Element => (
  <svg class="pitch-strip" viewBox="0 0 160 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="160" height="400" fill={SURFACE} />
    {[0, 2, 4, 6, 8, 10, 12, 14, 16].map((band) => <rect key={band} x="0" y={band * 25} width="160" height="25" fill="#17132E" />)}
    <rect x="44" y="20" width="72" height="360" fill={KEY} />
    {[0, 2, 4, 6, 8, 10, 12, 14].map((band) => <rect key={band} x="44" y={20 + band * 22} width="72" height="22" fill="#2B2752" />)}
    <g stroke={INK} stroke-width="2" fill="none">
      <line x1="30" y1="72" x2="130" y2="72" />
      <line x1="30" y1="328" x2="130" y2="328" />
      <line x1="44" y1="56" x2="116" y2="56" />
      <line x1="44" y1="344" x2="116" y2="344" />
      <line x1="58" y1="56" x2="58" y2="72" />
      <line x1="102" y1="56" x2="102" y2="72" />
      <line x1="58" y1="328" x2="58" y2="344" />
      <line x1="102" y1="328" x2="102" y2="344" />
    </g>
    <g fill={INK}>
      {[74, 80, 86].map((x) => <rect key={x} x={x} y="50" width="3" height="8" />)}
      {[74, 80, 86].map((x) => <rect key={x} x={x} y="342" width="3" height="8" />)}
    </g>
    <path d="M82 38 C 84 128 86 183 90 233 C 94 278 70 311 72 322" fill="none" stroke={INK} stroke-width="3" stroke-dasharray="8 8" />
    <circle cx="90" cy="233" r="7" fill="none" stroke={INK} stroke-width="3" />
    <circle cx="72" cy="322" r="6" fill={INK} />
  </svg>
);

const PAD_LABELS = ['0', '1', '2', '3', '4', '5', '6', 'Wide', 'No-ball', 'Bye', 'Leg bye', 'Wicket', 'Undo'];

/** The scoring pad, close up: sixteen cells, thirteen keys, the No-ball key armed. */
const PadArt = (): JSX.Element => (
  <svg class="art" viewBox="0 0 400 400" role="presentation" aria-hidden="true" focusable="false">
    <rect width="400" height="400" fill={SURFACE} />
    {PAD_LABELS.map((label, index) => {
      const x = 12 + (index % 4) * 96;
      const y = 12 + Math.floor(index / 4) * 96;
      const armed = label === 'No-ball';
      return (
        <g key={label}>
          <rect x={x} y={y} width="88" height="88" fill={KEY} stroke={armed ? LIME : 'none'} stroke-width={armed ? 5 : 0} />
          <text x={x + 44} y={y + (armed ? 46 : 52)} text-anchor="middle" font-family="DM Sans, sans-serif" font-weight="700" font-size={label.length > 2 ? 17 : 30} fill={INK}>{label}</text>
          {armed ? <text x={x + 44} y={y + 70} text-anchor="middle" font-family="DM Sans, sans-serif" font-weight="700" font-size="14" fill={INK}>armed</text> : null}
        </g>
      );
    })}
  </svg>
);

const OVER_MARKS = [{ chip: '0', r: 4 }, { chip: '1', r: 9 }, { chip: '4', r: 18 }, { chip: '0', r: 4 }, { chip: '6', r: 24 }, { chip: 'W', r: 0 }];

/** One over: a mark per delivery, larger for more runs, along a pitch. */
const OverArt = (): JSX.Element => (
  <svg class="art" viewBox="0 0 480 220" aria-hidden="true" focusable="false">
    <rect width="480" height="220" fill={SURFACE} />
    <rect x="20" y="60" width="440" height="80" fill={KEY} />
    {[0, 2, 4, 6, 8, 10].map((band) => <rect key={band} x={20 + band * 40} y="60" width="40" height="80" fill="#2B2752" />)}
    <line x1="36" y1="52" x2="36" y2="148" stroke={INK} stroke-width="3" />
    <line x1="444" y1="52" x2="444" y2="148" stroke={INK} stroke-width="3" />
    {OVER_MARKS.map((mark, index) => {
      const x = 80 + index * 64;
      return (
        <g key={index}>
          {mark.chip === 'W' ? <path d={`M${x - 14} 86L${x + 14} 114M${x + 14} 86L${x - 14} 114`} stroke={INK} stroke-width="6" fill="none" /> : (
            <circle cx={x} cy="100" r={mark.r} fill={mark.chip === '0' ? 'none' : INK} stroke={INK} stroke-width="3" />
          )}
          <text x={x} y="186" text-anchor="middle" font-family="DM Sans, sans-serif" font-weight="700" font-size="22" fill={INK}>{mark.chip}</text>
        </g>
      );
    })}
  </svg>
);

const SLAB_ROWS = [['Kestrels', '2', '2', '4', '+0.375'], ['Herons', '2', '1', '2', '+1.250'], ['Ospreys', '2', '1', '2', '+0.400'], ['Falcons', '2', '0', '0', '-2.060']];
const SLAB_COLUMNS = [24, 250, 300, 350, 440];

/** A points table: banded rows, the net run rate with its sign. */
const SlabArt = (): JSX.Element => (
  <svg class="art" viewBox="0 0 520 300" aria-hidden="true" focusable="false">
    <rect width="520" height="300" fill={BAND} />
    {['Team', 'P', 'W', 'Pts', 'NRR'].map((head, index) => (
      <text key={head} x={SLAB_COLUMNS[index]} y="46" font-family="DM Sans, sans-serif" font-weight="700" font-size="18" fill="#FFFFFF">{head}</text>
    ))}
    {SLAB_ROWS.map((row, line) => (
      <g key={row[0]}>
        <rect x="0" y={64 + line * 58} width="520" height="58" fill={line % 2 === 0 ? BAND_DEEP : BAND} />
        {row.map((cell, index) => (
          <text key={index} x={SLAB_COLUMNS[index]} y={100 + line * 58} font-family={index === 0 ? 'Dela Gothic One, Impact, sans-serif' : 'DM Sans, sans-serif'} font-weight="500" font-size={index === 0 ? 22 : 20} fill="#FFFFFF">{cell}</text>
        ))}
      </g>
    ))}
  </svg>
);

const wedge = (cx: number, cy: number, radius: number, from: number, to: number): string => {
  const point = (angle: number): string => `${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)}`;
  return `M${cx} ${cy} L${point(from)} A${radius} ${radius} 0 0 1 ${point(to)} Z`;
};

const WHEEL_TRAILS = [-1.9, -1.1, -0.2, 0.7, 1.6, 2.5, 3.5];

/** A wagon wheel: the field in eight zones, with the paths of shots to the boundary. */
const WheelArt = (): JSX.Element => (
  <svg class="art" viewBox="0 0 420 420" aria-hidden="true" focusable="false">
    <rect width="420" height="420" fill={GROUND} />
    {Array.from({ length: 8 }, (_, zone) => (
      <path key={zone} d={wedge(210, 210, 190, (zone * Math.PI) / 4, ((zone + 1) * Math.PI) / 4)} fill={zone % 2 === 0 ? BAND : SURFACE} />
    ))}
    <circle cx="210" cy="210" r="190" fill="none" stroke={INK} stroke-width="4" />
    <circle cx="210" cy="210" r="96" fill="none" stroke={INK} stroke-width="2" stroke-dasharray="6 8" />
    <rect x="202" y="170" width="16" height="80" fill={KEY} />
    {WHEEL_TRAILS.map((angle, index) => (
      <path key={angle} d={`M210 210 Q ${210 + 80 * Math.cos(angle + 0.35)} ${210 + 80 * Math.sin(angle + 0.35)} ${210 + (130 + (index % 3) * 28) * Math.cos(angle)} ${210 + (130 + (index % 3) * 28) * Math.sin(angle)}`} fill="none" stroke={INK} stroke-width="3" />
    ))}
  </svg>
);

const Panel = ({ title, line, tone, children }: { title: string; line: string; tone: 'ground' | 'surface' | 'band'; children: JSX.Element }): JSX.Element => (
  <section class={`panel panel-${tone}`}>
    <div class="panel-text">
      <h2>{title}</h2>
      <p>{line}</p>
    </div>
    <div class="panel-art">{children}</div>
  </section>
);

export const Landing = (): JSX.Element => {
  const user = userStore.use();
  return (
    <div class="stage">
      <div class="word word-over" aria-hidden="true">OVER</div>
      <section class="hero">
        <div class="hero-panel">
          <div class="hero-copy">
            <h1>Score every ball. Everyone sees it land.</h1>
            <Link href={user ? '/matches' : '/signin'} class="hero-start">Start scoring →</Link>
          </div>
          <ul class="hero-links">
            <li><Link href="/follow">Follow a match</Link></li>
            <li><Link href="/tournaments">Tournaments</Link></li>
            <li><Link href="/players">Careers</Link></li>
          </ul>
        </div>
        <div class="hero-pitch"><PitchStrip /></div>
      </section>
      <Panel title="A pad built for thumbs" line="Runs, extras, wickets and undo on square keys: one tap, or one key." tone="surface"><PadArt /></Panel>
      <Panel title="Every over, drawn" line="One mark for each delivery, bigger for more runs, with the over's sum beneath." tone="ground"><OverArt /></Panel>
      <Panel title="Tables that settle themselves" line="Points, net run rate and order move the moment a match gets its result." tone="band"><SlabArt /></Panel>
      <Panel title="Every ball, kept" line="Careers are built from finished scorecards, ball by ball." tone="surface"><WheelArt /></Panel>
      <div class="word word-call" aria-hidden="true">CALL</div>
    </div>
  );
};
