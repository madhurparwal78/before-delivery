// The four sticker shapes of the home page, also used once each on empty and error pages. Decorative: hidden from
// assistive technology, still, tilted by the page's CSS, with a solid plum offset shadow from `.sticker`.

export type StickerKind = 'pill' | 'sum' | 'blob' | 'at';

const PLUM = '#2B1325';
const INK = '#1A0A14';

function Shelf() {
  return (
    <svg viewBox="0 0 260 120" focusable="false" aria-hidden="true">
      <rect x="6" y="10" width="248" height="100" rx="50" fill="#FFFFFF" stroke="#D9E13F" strokeWidth="10" />
      <circle cx="52" cy="60" r="9" fill={PLUM} />
      <circle cx="82" cy="60" r="9" fill={PLUM} />
      <text x="116" y="72" fontSize="34" fontWeight="500" fill={INK} fontFamily="Stack Sans Headline, sans-serif">
        Region
      </text>
    </svg>
  );
}

function Sum() {
  return (
    <svg viewBox="0 0 260 120" focusable="false" aria-hidden="true">
      <rect x="6" y="10" width="248" height="100" rx="50" fill="#D9E13F" stroke={PLUM} strokeWidth="6" />
      <text x="130" y="76" fontSize="46" fontWeight="700" fill={INK} textAnchor="middle" fontFamily="Stack Sans Headline, sans-serif">
        SUM
      </text>
    </svg>
  );
}

function Blob() {
  return (
    <svg viewBox="0 0 200 200" focusable="false" aria-hidden="true">
      <path
        d="M100 10c44 0 84 30 88 78 4 50-34 102-88 102S12 150 12 100C12 48 56 10 100 10z"
        fill="#E9479F"
        stroke={PLUM}
        strokeWidth="6"
      />
      <rect x="54" y="104" width="24" height="46" rx="8" fill="#FFFFFF" stroke={PLUM} strokeWidth="5" />
      <rect x="88" y="72" width="24" height="78" rx="8" fill="#FFFFFF" stroke={PLUM} strokeWidth="5" />
      <rect x="122" y="90" width="24" height="60" rx="8" fill="#FFFFFF" stroke={PLUM} strokeWidth="5" />
    </svg>
  );
}

function At() {
  return (
    <svg viewBox="0 0 160 160" focusable="false" aria-hidden="true">
      <circle cx="80" cy="80" r="72" fill="#EAA0CD" stroke={PLUM} strokeWidth="6" />
      <circle cx="80" cy="80" r="54" fill="none" stroke={PLUM} strokeWidth="3" strokeDasharray="2 10" strokeLinecap="round" />
      <text x="80" y="102" fontSize="64" fontWeight="700" fill={INK} textAnchor="middle" fontFamily="Stack Sans Headline, sans-serif">
        AT
      </text>
    </svg>
  );
}

const SHAPES = { pill: Shelf, sum: Sum, blob: Blob, at: At } as const;

export function Sticker({ kind, className }: { kind: StickerKind; className?: string }) {
  const Shape = SHAPES[kind];
  return (
    <div className={className ? `sticker sticker-${kind} ${className}` : `sticker sticker-${kind}`}>
      <Shape />
    </div>
  );
}
