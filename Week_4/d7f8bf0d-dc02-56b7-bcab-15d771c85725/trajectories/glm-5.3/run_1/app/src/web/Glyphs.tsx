import React from 'react';

/** All glyphs and line art drawn for this product. */
export type GlyphName =
  | 'gear' | 'camera' | 'workspace' | 'plus' | 'exit' | 'play' | 'return'
  | 'build' | 'operate' | 'straight' | 'curve-left' | 'curve-right'
  | 'turnout-left' | 'turnout-right' | 'rise' | 'fall' | 'undo';

const PATHS: Record<GlyphName, React.ReactNode> = {
  gear: (
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4 1.6 1.4-1.8 3.2-2-.7a7 7 0 0 1-1.6 1l-.3 2.1h-3.8l-.3-2.1a7 7 0 0 1-1.6-1l-2 .7-1.8-3.2L9 12l-1.6-1.4 1.8-3.2 2 .7a7 7 0 0 1 1.6-1l.3-2.1h3.8l.3 2.1a7 7 0 0 1 1.6 1l2-.7 1.8 3.2z" fill="currentColor" />
  ),
  camera: (
    <g fill="currentColor">
      <rect x="3" y="7" width="18" height="13" rx="3" />
      <circle cx="12" cy="13.5" r="4" fill="#fff" />
      <rect x="9" y="4" width="6" height="3" rx="1" />
    </g>
  ),
  workspace: <path d="M4 20 8 9l4 5 3-8 5 14z" fill="currentColor" />,
  plus: <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z" fill="currentColor" />,
  exit: (
    <g fill="currentColor">
      <path d="M10 4H5v16h5v-2H7V6h3z" />
      <path d="M14 7l5 5-5 5-1.4-1.4L15.2 13H9v-2h6.2l-2.6-2.6z" />
    </g>
  ),
  play: <path d="M8 5v14l11-7z" fill="currentColor" />,
  return: (
    <g fill="currentColor">
      <path d="M10 5H4v6h2V8.4l4.3 4.3 1.4-1.4L7.4 7H10z" />
      <path d="M14 12h6v7h-2v-5h-4z" />
    </g>
  ),
  build: (
    <g fill="currentColor">
      <path d="M3 17h18v3H3z" />
      <path d="M5 14h3l2-7h2l2 7h3v-2h-3.4l-1.6-5h-4l-1.6 5H5z" />
    </g>
  ),
  operate: (
    <g fill="currentColor">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3a9 9 0 0 1 9 9h-2a7 7 0 0 0-7-7zM12 21a9 9 0 0 1-9-9h2a7 7 0 0 0 7 7z" />
    </g>
  ),
  straight: (
    <g fill="currentColor">
      <rect x="2" y="10" width="20" height="4" rx="2" />
    </g>
  ),
  'curve-left': (
    <g fill="currentColor">
      <path d="M4 20c0-10 6-16 16-16v4C12 8 8 12 8 20z" />
    </g>
  ),
  'curve-right': (
    <g fill="currentColor">
      <path d="M20 20c0-10-6-16-16-16v4c8 0 12 4 12 12z" />
    </g>
  ),
  'turnout-left': (
    <g fill="currentColor">
      <path d="M2 10h20v4H2z" />
      <path d="M6 14l8 6 8-6-2-2.6-6 4.2-6-4.2z" />
    </g>
  ),
  'turnout-right': (
    <g fill="currentColor">
      <path d="M2 10h20v4H2z" />
      <path d="M18 4l-8 6-8-6 2-2.6 6 4.2 6-4.2z" />
    </g>
  ),
  rise: (
    <g fill="currentColor">
      <rect x="2" y="13" width="18" height="4" rx="2" />
      <path d="M16 6h5v5h-5z" />
    </g>
  ),
  fall: (
    <g fill="currentColor">
      <rect x="2" y="8" width="18" height="4" rx="2" />
      <path d="M16 14h5v5h-5z" />
    </g>
  ),
  undo: (
    <g fill="currentColor">
      <path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" />
    </g>
  ),
};

export function Glyph({ name }: { name: GlyphName }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** Touch gestures illustration for the walkthrough card. */
export function TouchArt(): React.ReactElement {
  return (
    <svg viewBox="0 0 120 84" aria-label="Touch gestures illustration" data-testid="walkthrough-art" data-input="touch">
      <rect x="34" y="8" width="52" height="72" rx="8" fill="none" stroke="#1848c2" strokeWidth="3" />
      <path d="M60 20v34M60 54l-8-8M60 54l8-8" stroke="#ff8b21" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="22" cy="42" r="10" fill="none" stroke="#23b04b" strokeWidth="3" />
      <circle cx="100" cy="42" r="10" fill="none" stroke="#23b04b" strokeWidth="3" />
      <path d="M8 62c6 6 14 6 20 0M92 62c6 6 14 6 20 0" stroke="#3fa9f5" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Mouse and keyboard illustration for the walkthrough card. */
export function PointerArt(): React.ReactElement {
  return (
    <svg viewBox="0 0 120 84" aria-label="Mouse and keyboard illustration" data-testid="walkthrough-art" data-input="pointer">
      <rect x="6" y="10" width="88" height="52" rx="8" fill="none" stroke="#1848c2" strokeWidth="3" />
      <rect x="6" y="10" width="88" height="52" rx="8" fill="none" stroke="#1848c2" strokeWidth="3" />
      <g stroke="#3fa9f5" strokeWidth="2.5" fill="none">
        <line x1="14" y1="20" x2="26" y2="20" />
        <line x1="32" y1="20" x2="44" y2="20" />
        <line x1="50" y1="20" x2="62" y2="20" />
        <line x1="68" y1="20" x2="80" y2="20" />
        <line x1="14" y1="30" x2="26" y2="30" />
        <line x1="32" y1="30" x2="44" y2="30" />
        <line x1="50" y1="30" x2="62" y2="30" />
        <line x1="68" y1="30" x2="80" y2="30" />
        <line x1="14" y1="40" x2="26" y2="40" />
        <line x1="32" y1="40" x2="44" y2="40" />
        <line x1="50" y1="40" x2="62" y2="40" />
        <line x1="68" y1="40" x2="80" y2="40" />
      </g>
      <path d="M100 44c0-8 6-14 12-14v20c0 4-3 8-8 8-2 0-4-2-4-6z" fill="#ff8b21" stroke="#d95d00" strokeWidth="2" />
    </svg>
  );
}
