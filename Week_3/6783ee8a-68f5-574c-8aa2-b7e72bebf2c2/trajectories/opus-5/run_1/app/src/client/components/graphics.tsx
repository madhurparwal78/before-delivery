const GLYPH_KINDS = ['braces', 'sigma', 'lambda', 'leaf', 'hexagon', 'cube', 'gear', 'bar'] as const;

type GlyphKind = (typeof GLYPH_KINDS)[number];

function Glyph({ kind }: { kind: GlyphKind }): JSX.Element {
  switch (kind) {
    case 'braces':
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M-5 -7c-3 0 -3 5 -5 7 2 2 2 7 5 7" />
          <path d="M5 -7c3 0 3 5 5 7 -2 2 -2 7 -5 7" />
        </g>
      );
    case 'sigma':
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M5 -7h-9l6 7 -6 7h9" />
        </g>
      );
    case 'lambda':
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M-6 7 1 -7 7 7" />
          <path d="M-2 -1h5" />
        </g>
      );
    case 'leaf':
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M-6 6c0 -8 6 -12 12 -12 0 7 -5 12 -12 12z" />
          <path d="M-3 3 4 -4" />
        </g>
      );
    case 'hexagon':
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="M0 -8 7 -4v8L0 8 -7 4v-8z" />
        </g>
      );
    case 'cube':
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
          <path d="M0 -8 7 -4 0 0 -7 -4z" />
          <path d="M-7 -4v8L0 8V0" />
          <path d="M7 -4v8L0 8" />
        </g>
      );
    case 'gear':
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle r="3.4" />
          <path d="M0 -7.5v2.6M0 7.5v-2.6M-7.5 0h2.6M7.5 0h-2.6M-5.3 -5.3 -3.5 -3.5M5.3 5.3 3.5 3.5M5.3 -5.3 3.5 -3.5M-5.3 5.3 -3.5 3.5" />
        </g>
      );
    default:
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M-6 4v-6M-2 4v-10M2 4v-7M6 4v-3" />
        </g>
      );
  }
}

/** The hero: two orange brackets around the wordmark, inside a glyph cloud. */
export function BrackenpadMark(): JSX.Element {
  const cloud = Array.from({ length: 30 }, (_value, index) => {
    const angle = (index / 30) * Math.PI * 2 + 0.18;
    const wobble = ((index * 37) % 11) / 11;
    const radiusX = 372 + wobble * 34;
    const radiusY = 136 + (((index * 23) % 7) / 7) * 28;
    return {
      kind: GLYPH_KINDS[index % GLYPH_KINDS.length],
      x: 420 + Math.cos(angle) * radiusX,
      y: 190 + Math.sin(angle) * radiusY,
      scale: 0.8 + ((index * 13) % 5) / 7,
      opacity: 0.2 + ((index * 17) % 6) / 10,
      tilt: ((index * 29) % 24) - 12,
    };
  });

  return (
    <svg
      className="hero-mark"
      viewBox="0 0 840 380"
      role="img"
      aria-label="Brackenpad"
      preserveAspectRatio="xMidYMid meet"
    >
      <g className="hero-cloud">
        {cloud.map((glyph, index) => (
          <g
            key={index}
            transform={`translate(${glyph.x.toFixed(1)} ${glyph.y.toFixed(1)}) rotate(${glyph.tilt}) scale(${glyph.scale.toFixed(2)})`}
            opacity={glyph.opacity.toFixed(2)}
          >
            <Glyph kind={glyph.kind} />
          </g>
        ))}
      </g>
      <g className="hero-brackets">
        <path
          d="M292 128c-22 0-30 12-30 30v24c0 10-6 14-14 14 8 0 14 4 14 14v24c0 18 8 30 30 30"
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
        />
        <path
          d="M548 128c22 0 30 12 30 30v24c0 10 6 14 14 14-8 0-14 4-14 14v24c0 18-8 30-30 30"
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
        />
      </g>
      <text className="hero-wordmark" x="420" y="207" textAnchor="middle">
        brackenpad
      </text>
      <g className="hero-dots">
        <circle cx="610" cy="118" r="9" />
        <circle cx="640" cy="146" r="5.5" />
        <circle cx="624" cy="92" r="3.5" />
      </g>
    </svg>
  );
}

/** A cascade of mock notebook windows, as used by the product rows. */
export function MockNotebookCascade({ withChart = true }: { withChart?: boolean }): JSX.Element {
  return (
    <svg className="mock-cascade" viewBox="0 0 420 300" role="presentation" aria-hidden="true">
      {[0, 1, 2].map((index) => {
        const x = 18 + index * 54;
        const y = 24 + index * 18;
        return (
          <g key={index} transform={`translate(${x} ${y})`}>
            <rect className="mock-frame" x="0" y="0" width="300" height="200" rx="2" />
            <rect className="mock-bar" x="0" y="0" width="300" height="22" rx="2" />
            <circle className="mock-dot" cx="14" cy="11" r="3" />
            <circle className="mock-dot" cx="26" cy="11" r="3" />
            <circle className="mock-dot" cx="38" cy="11" r="3" />
            <text className="mock-code" x="14" y="46">
              const heights = [1.2, 1.9]
            </text>
            <rect className="mock-cell" x="12" y="54" width="276" height="26" rx="2" />
            <text className="mock-code" x="18" y="72">
              heights.length
            </text>
            <rect className="mock-cell" x="12" y="88" width="276" height="26" rx="2" />
            <text className="mock-code" x="18" y="106">
              Math.max(...heights)
            </text>
            {withChart && index === 2 ? (
              <g>
                <path className="mock-axis" d="M16 184H286" />
                <path className="mock-axis" d="M16 184V124" />
                <path className="mock-line" d="M20 174 64 150 108 162 152 132 196 144 240 128 280 138" />
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export type FeatureIcon = 'browser' | 'together' | 'format' | 'find';

export function LineIcon({ icon }: { icon: FeatureIcon }): JSX.Element {
  const paths: Record<FeatureIcon, JSX.Element> = {
    browser: (
      <g>
        <rect x="4" y="7" width="40" height="34" rx="2" />
        <path d="M4 16h40" />
        <path d="M18 24l-5 6 5 6M30 24l5 6-5 6" />
      </g>
    ),
    together: (
      <g>
        <circle cx="17" cy="18" r="6" />
        <circle cx="33" cy="22" r="5" />
        <path d="M6 40c0-7 5-11 11-11s11 4 11 11" />
        <path d="M27 40c0-6 3-9 7-9s8 3 8 9" />
      </g>
    ),
    format: (
      <g>
        <path d="M14 8h14l8 8v24a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
        <path d="M28 8v9h8" />
        <path d="M18 28h12M18 34h8" />
      </g>
    ),
    find: (
      <g>
        <circle cx="21" cy="21" r="12" />
        <path d="M30 30l12 12" />
        <path d="M15 19h12M15 24h8" />
      </g>
    ),
  };
  return (
    <svg className="line-icon" viewBox="0 0 48 48" role="presentation" aria-hidden="true" fill="none">
      {paths[icon]}
    </svg>
  );
}

export type CardIcon = 'format' | 'plan' | 'leave';

export function OutlinedCardIcon({ icon }: { icon: CardIcon }): JSX.Element {
  const paths: Record<CardIcon, JSX.Element> = {
    format: (
      <g>
        <rect x="6" y="6" width="28" height="28" rx="2" />
        <path d="M13 15l-4 5 4 5M27 15l4 5-4 5" />
      </g>
    ),
    plan: (
      <g>
        <circle cx="20" cy="20" r="14" />
        <path d="M14 20h12M20 14v12" />
      </g>
    ),
    leave: (
      <g>
        <path d="M8 8h16l8 8v16H8z" />
        <path d="M20 20v9M16 25l4 4 4-4" />
      </g>
    ),
  };
  return (
    <svg className="card-icon" viewBox="0 0 40 40" role="presentation" aria-hidden="true" fill="none">
      {paths[icon]}
    </svg>
  );
}

export type DiscGlyph = 'write' | 'queue' | 'run' | 'checkpoint';

export function DiscGlyphIcon({ glyph }: { glyph: DiscGlyph }): JSX.Element {
  const paths: Record<DiscGlyph, JSX.Element> = {
    write: <path d="M10 26l14-14 4 4-14 14H10z" />,
    queue: <path d="M10 13h18M10 19h18M10 25h11" />,
    run: <path d="M14 10l14 9-14 9z" />,
    checkpoint: <path d="M10 19l6 6 12-13" />,
  };
  return (
    <svg className="disc-glyph" viewBox="0 0 38 38" role="presentation" aria-hidden="true" fill="none">
      {paths[glyph]}
    </svg>
  );
}

/** The grey line the lifecycle discs sit on, a shallow smile. */
export function DiscArcLine(): JSX.Element {
  return (
    <svg className="disc-arc-line" viewBox="0 0 900 90" role="presentation" aria-hidden="true">
      <path d="M20 18C250 92 650 92 880 18" fill="none" />
    </svg>
  );
}

export function EmptyStateIcon(): JSX.Element {
  return (
    <svg className="empty-icon" viewBox="0 0 64 64" role="presentation" aria-hidden="true" fill="none">
      <rect x="10" y="8" width="44" height="48" rx="2" />
      <path d="M20 22h24M20 32h24M20 42h14" />
    </svg>
  );
}
