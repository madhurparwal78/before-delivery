interface RoomPortraitProps {
  roomId: string;
}

/** Flat drawn elevations: ink and dark wine lines on the room's pink ground, no photography. */
export function RoomPortrait({ roomId }: RoomPortraitProps): JSX.Element {
  return (
    <svg
      className="portrait"
      viewBox="0 0 200 300"
      role="presentation"
      focusable="false"
      aria-hidden="true"
    >
      <g className="portrait-ink">{figureFor(roomId)}</g>
    </svg>
  );
}

function figureFor(roomId: string): JSX.Element {
  switch (roomId) {
    case 'window-row':
      return (
        <>
          <rect x="18" y="30" width="164" height="190" className="line" />
          <rect x="34" y="46" width="60" height="110" className="wine" />
          <rect x="106" y="46" width="60" height="110" className="wine" />
          <line x1="64" y1="46" x2="64" y2="156" className="line" />
          <line x1="136" y1="46" x2="136" y2="156" className="line" />
          <rect x="40" y="180" width="50" height="10" className="ink" />
          <rect x="110" y="180" width="50" height="10" className="ink" />
          <line x1="18" y1="220" x2="182" y2="220" className="line" />
          <line x1="40" y1="220" x2="40" y2="262" className="line" />
          <line x1="160" y1="220" x2="160" y2="262" className="line" />
        </>
      );
    case 'hearth':
      return (
        <>
          <rect x="24" y="40" width="152" height="180" className="line" />
          <rect x="66" y="110" width="68" height="110" className="wine" />
          <rect x="78" y="150" width="44" height="70" className="ink" />
          <rect x="56" y="92" width="88" height="14" className="ink" />
          <line x1="100" y1="40" x2="100" y2="92" className="line" />
          <line x1="24" y1="236" x2="176" y2="236" className="line" />
          <circle cx="44" cy="200" r="12" className="line" />
          <circle cx="156" cy="200" r="12" className="line" />
        </>
      );
    case 'slate-room':
      return (
        <>
          <rect x="20" y="36" width="160" height="196" className="line" />
          <rect x="34" y="50" width="40" height="168" className="wine" />
          <rect x="80" y="50" width="40" height="168" className="wine" />
          <rect x="126" y="50" width="40" height="168" className="wine" />
          <line x1="20" y1="150" x2="180" y2="150" className="line" />
          <rect x="60" y="238" width="80" height="12" className="ink" />
          <line x1="70" y1="250" x2="70" y2="276" className="line" />
          <line x1="130" y1="250" x2="130" y2="276" className="line" />
        </>
      );
    case 'bar-rail':
      return (
        <>
          <rect x="22" y="44" width="156" height="120" className="line" />
          <line x1="22" y1="84" x2="178" y2="84" className="line" />
          <line x1="22" y1="124" x2="178" y2="124" className="line" />
          <rect x="30" y="176" width="140" height="16" className="ink" />
          <rect x="30" y="192" width="140" height="8" className="wine" />
          <line x1="60" y1="200" x2="60" y2="252" className="line" />
          <line x1="140" y1="200" x2="140" y2="252" className="line" />
          <circle cx="60" cy="262" r="10" className="line" />
          <circle cx="140" cy="262" r="10" className="line" />
        </>
      );
    case 'courtyard':
      return (
        <>
          <path d="M40 230 L40 120 A60 60 0 0 1 160 120 L160 230" className="line" />
          <path d="M70 230 L70 130 A30 30 0 0 1 130 130 L130 230" className="wine" />
          <line x1="20" y1="230" x2="180" y2="230" className="line" />
          <circle cx="46" cy="252" r="14" className="wine" />
          <circle cx="154" cy="252" r="14" className="wine" />
          <rect x="88" y="246" width="24" height="24" className="ink" />
        </>
      );
    case 'chefs-counter':
    default:
      return (
        <>
          <rect x="24" y="40" width="152" height="120" className="line" />
          <rect x="48" y="60" width="104" height="60" className="wine" />
          <line x1="100" y1="60" x2="100" y2="120" className="line" />
          <rect x="28" y="180" width="144" height="18" className="ink" />
          <circle cx="60" cy="222" r="11" className="line" />
          <circle cx="100" cy="222" r="11" className="line" />
          <circle cx="140" cy="222" r="11" className="line" />
          <line x1="28" y1="256" x2="172" y2="256" className="line" />
        </>
      );
  }
}
