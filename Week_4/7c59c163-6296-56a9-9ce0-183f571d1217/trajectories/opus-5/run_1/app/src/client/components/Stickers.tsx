/** Die-cut sticker shapes drawn procedurally: a YES/NO coin, a margin dial, a spot cube, an envelope. */

export type StickerKind = 'coin' | 'dial' | 'cube' | 'envelope';

const SAGE = '#c3d2c3';
const BLUSH = '#e3cfc8';
const SURFACE = '#dce4ed';
const OLIVE = '#414a1c';
const INK = '#10161c';
const STONE = '#f3f1e6';

const FILL: Record<StickerKind, string> = {
  coin: SAGE,
  dial: BLUSH,
  cube: SURFACE,
  envelope: OLIVE,
};

const TILT: Record<StickerKind, number> = { coin: 7, dial: -5, cube: 11, envelope: -3 };

const LABEL: Record<StickerKind, string> = {
  coin: 'Event contracts',
  dial: 'Margin',
  cube: 'Spot',
  envelope: 'Statements',
};

export interface StickerProps {
  kind: StickerKind;
  size?: number;
  animate?: boolean;
  className?: string;
}

export function Sticker(props: StickerProps): React.JSX.Element {
  const size = props.size ?? 140;
  const stroke = props.kind === 'envelope' ? STONE : INK;
  return (
    <svg
      className={`${props.className ?? ''} ${props.animate === true ? 'sticker-enter' : ''}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={LABEL[props.kind]}
      style={{ transform: `rotate(${TILT[props.kind]}deg)` }}
    >
      <Shape kind={props.kind} fill={FILL[props.kind]} stroke={stroke} />
    </svg>
  );
}

function Shape(props: { kind: StickerKind; fill: string; stroke: string }): React.JSX.Element {
  const { fill, stroke } = props;
  switch (props.kind) {
    case 'coin':
      return (
        <g>
          <circle cx="60" cy="60" r="52" fill={fill} stroke={stroke} strokeWidth="5" />
          <path d="M60 8a52 52 0 0 1 0 104z" fill={BLUSH} stroke={stroke} strokeWidth="5" />
          <path d="M30 50l8 22 10-22" fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round" />
          <path d="M74 72V48l16 24V48" fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round" />
        </g>
      );
    case 'dial':
      return (
        <g>
          <circle cx="60" cy="60" r="52" fill={fill} stroke={stroke} strokeWidth="5" />
          <path d="M22 72a42 42 0 0 1 76 0" fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round" />
          <path d="M60 68L84 40" stroke={OLIVE} strokeWidth="9" strokeLinecap="round" />
          <circle cx="60" cy="70" r="9" fill={stroke} />
        </g>
      );
    case 'cube':
      return (
        <g>
          <path d="M60 10l44 24v52L60 110 16 86V34z" fill={fill} stroke={stroke} strokeWidth="5" />
          <path d="M16 34l44 24 44-24M60 58v52" fill="none" stroke={stroke} strokeWidth="5" />
          <path d="M60 10l44 24-44 24-44-24z" fill={SAGE} stroke={stroke} strokeWidth="5" />
        </g>
      );
    case 'envelope':
      return (
        <g>
          <rect x="10" y="26" width="100" height="68" rx="14" fill={fill} stroke={stroke} strokeWidth="5" />
          <path d="M14 34l46 34 46-34" fill="none" stroke={stroke} strokeWidth="6" strokeLinecap="round" />
          <path d="M10 88l36-28M110 88L74 60" fill="none" stroke={stroke} strokeWidth="5" />
        </g>
      );
  }
}
