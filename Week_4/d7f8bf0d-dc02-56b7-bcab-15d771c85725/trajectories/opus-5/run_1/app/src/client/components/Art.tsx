interface GlyphProps {
  size?: number;
  className?: string;
}

const LETTERS: { char: string; fill: string; shade: string; dy: number }[] = [
  { char: 'G', fill: '#38a9ef', shade: '#1b6fb0', dy: 0 },
  { char: 'a', fill: '#f5811f', shade: '#b55706', dy: -7 },
  { char: 'n', fill: '#35a84a', shade: '#1f7733', dy: 4 },
  { char: 'd', fill: '#7a5cf0', shade: '#4a32ad', dy: -4 },
  { char: 'y', fill: '#ef3f7a', shade: '#ad1f4e', dy: 7 },
  { char: 'b', fill: '#1b3a94', shade: '#0e2360', dy: -5 },
  { char: 'o', fill: '#f5b81f', shade: '#b58306', dy: 3 },
  { char: 'a', fill: '#19b5b0', shade: '#0b7d79', dy: -6 },
  { char: 'r', fill: '#f5811f', shade: '#b55706', dy: 5 },
  { char: 'd', fill: '#38a9ef', shade: '#1b6fb0', dy: -2 },
];

/** The Gandyboard puffy wordmark: letters in their own colours on a playful baseline. */
export function Wordmark({ className }: { className?: string }): JSX.Element {
  const step = 46;
  const left = 10;
  return (
    <svg
      role="img"
      aria-label="Gandyboard"
      data-testid="splash-wordmark"
      className={className}
      viewBox="0 0 484 150"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fontFamily="Fredoka, Trebuchet MS, sans-serif" fontWeight={600} fontSize={82}>
        {LETTERS.map((letter, index) => (
          <text
            key={`shade-${index}`}
            x={left + index * step}
            y={108 + letter.dy + 5}
            fill={letter.shade}
          >
            {letter.char}
          </text>
        ))}
        {LETTERS.map((letter, index) => (
          <text key={`face-${index}`} x={left + index * step} y={108 + letter.dy} fill={letter.fill}>
            {letter.char}
          </text>
        ))}
      </g>
    </svg>
  );
}

function glyph(size: number, children: JSX.Element, className?: string): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function GearGlyph({ size = 20, className }: GlyphProps): JSX.Element {
  return glyph(
    size,
    <>
      <circle cx="12" cy="12" r="3.3" />
      <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
    </>,
    className,
  );
}

export function CameraGlyph({ size = 20, className }: GlyphProps): JSX.Element {
  return glyph(
    size,
    <>
      <path d="M3 8.5h3l1.6-2.2h8.8L18 8.5h3v10H3z" />
      <circle cx="12" cy="13" r="3.2" />
    </>,
    className,
  );
}

export function PlayGlyph({ size = 22, className }: GlyphProps): JSX.Element {
  return glyph(size, <path d="M8 5.6 19 12 8 18.4z" fill="currentColor" />, className);
}

export function ReturnGlyph({ size = 22, className }: GlyphProps): JSX.Element {
  return glyph(
    size,
    <>
      <path d="M9 7 4.5 11.5 9 16" />
      <path d="M4.5 11.5h9a6 6 0 0 1 0 12H10" />
    </>,
    className,
  );
}

export function BuildGlyph({ size = 22, className }: GlyphProps): JSX.Element {
  return glyph(
    size,
    <>
      <path d="M3 17h18" />
      <path d="M6 17v-3M10 17v-3M14 17v-3M18 17v-3" />
      <path d="M4 11h16" />
      <path d="M4 7h16" />
    </>,
    className,
  );
}

export function OperateGlyph({ size = 22, className }: GlyphProps): JSX.Element {
  return glyph(
    size,
    <>
      <rect x="5" y="4" width="14" height="12" rx="3" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M8 20h8M9 16l-1 4M15 16l1 4" />
    </>,
    className,
  );
}

export function SchematicGlyph({ size = 20, className }: GlyphProps): JSX.Element {
  return glyph(
    size,
    <>
      <path d="M3 8h18M3 16h18" />
      <path d="M8 8v8M16 8v8" />
    </>,
    className,
  );
}

export function HeadingNeedle({ heading }: { heading: number }): JSX.Element {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="18" fill="#ffffff" stroke="#ced4ec" strokeWidth="1.5" />
      {Array.from({ length: 8 }, (unused, index) => {
        const angle = (index * 45 * Math.PI) / 180;
        return (
          <line
            key={index}
            x1={20 + Math.sin(angle) * 13}
            y1={20 - Math.cos(angle) * 13}
            x2={20 + Math.sin(angle) * 16}
            y2={20 - Math.cos(angle) * 16}
            stroke="#9aa4c8"
            strokeWidth="1.6"
          />
        );
      })}
      <path d="M20 2.5a17.5 17.5 0 0 1 12.4 5.1" fill="none" stroke="#35a84a" strokeWidth="3" />
      <g transform={`rotate(${heading} 20 20)`}>
        <path d="M20 6 23 19 20 17 17 19z" fill="#38a9ef" stroke="#1b3a94" strokeWidth="1.2" />
      </g>
      <circle cx="20" cy="20" r="2.6" fill="#1b3a94" />
    </svg>
  );
}

const TILE_GLYPHS: Record<string, JSX.Element> = {
  'Straight 12 in': <path d="M3 12h18" />,
  'Straight 6 in': <path d="M7 12h10" />,
  'Curve left': <path d="M4 19c0-8 5-13 14-13" />,
  'Curve right': <path d="M20 19c0-8-5-13-14-13" />,
  'Turnout left': (
    <>
      <path d="M3 17h18" />
      <path d="M6 17c6 0 9-3 13-9" />
    </>
  ),
  'Turnout right': (
    <>
      <path d="M3 17h18" />
      <path d="M18 17c-6 0-9-3-13-9" />
    </>
  ),
  Rise: <path d="M4 18 20 7M15 7h5v5" />,
  Fall: <path d="M4 7l16 11M15 18h5v-5" />,
  'Undo last piece': (
    <>
      <path d="M8 7 4 11l4 4" />
      <path d="M4 11h9a6 6 0 0 1 0 12" />
    </>
  ),
};

export function TileGlyph({ name }: { name: string }): JSX.Element {
  return glyph(26, <>{TILE_GLYPHS[name] ?? <circle cx="12" cy="12" r="7" />}</>, 'tile-glyph');
}

export function TouchArt(): JSX.Element {
  return (
    <svg
      role="img"
      aria-label="Touch gestures illustration"
      data-testid="walkthrough-art"
      data-input="touch"
      className="walkthrough-art"
      viewBox="0 0 200 150"
      fill="none"
      stroke="#38a9ef"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="22" y="12" width="76" height="126" rx="12" />
      <path d="M44 24h32" />
      <rect x="32" y="40" width="56" height="70" rx="6" />
      <path d="M128 136V96c0-18 6-26 6-38V38a7 7 0 0 1 14 0v34" />
      <path d="M148 72V52a7 7 0 0 1 14 0v22" />
      <path d="M162 74V60a7 7 0 0 1 14 0v40c0 18-10 36-22 36h-26" />
      <path d="M104 62l16-10M104 86l16 10" />
    </svg>
  );
}

export function PointerArt(): JSX.Element {
  return (
    <svg
      role="img"
      aria-label="Mouse and keyboard illustration"
      data-testid="walkthrough-art"
      data-input="pointer"
      className="walkthrough-art"
      viewBox="0 0 200 150"
      fill="none"
      stroke="#38a9ef"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="18" y="86" width="116" height="48" rx="8" />
      <path d="M30 98h92M30 112h18M56 112h50M114 112h8M30 124h92" />
      <path d="M152 30a22 22 0 0 1 22 22v40a22 22 0 0 1-44 0V52a22 22 0 0 1 22-22z" />
      <path d="M152 30v28M130 58h44" />
    </svg>
  );
}

export function EmptyArt(): JSX.Element {
  return (
    <svg
      width="92"
      height="68"
      viewBox="0 0 92 68"
      fill="none"
      stroke="#38a9ef"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 50h80" />
      <path d="M16 50V38h22v12M48 50V30h26v20" />
      <path d="M12 58h68" />
    </svg>
  );
}
