import type { JSX } from 'preact';

type Draw = () => JSX.Element;

const stroke = (d: string): Draw => () => <path d={d} />;

const shapes: Record<string, Draw> = {
  star: () => <polygon points="12 2.5 15 9 22 9.8 16.8 14.5 18.3 21.5 12 18 5.7 21.5 7.2 14.5 2 9.8 9 9" />,
  flag: stroke('M5 21V4M5 4h13l-3 4.5 3 4.5H5'),
  bulb: stroke('M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z'),
  check: () => <polyline points="4 12.5 9.5 18 20 6.5" />,
  cross: stroke('M6 6l12 12M18 6L6 18'),
  question: stroke('M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4M12 18h.01'),
  clock: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </>
  ),
  calendar: () => (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </>
  ),
  pin: () => (
    <>
      <path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z" />
      <circle cx="12" cy="11" r="2" />
    </>
  ),
  home: stroke('M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10'),
  book: stroke('M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4zM12 5v15'),
  pencil: stroke('M4 20l1-5L16 4l4 4L9 19zM14 6l4 4'),
  music: stroke('M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3M20 16a3 3 0 1 1-3-3'),
  coin: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9.5c0-1 1.2-1.5 3-1.5s3 .6 3 1.8-1.5 1.6-3 2-3 .8-3 2.2 1.2 1.8 3 1.8 3-.6 3-1.5M12 6.5V8M12 16v1.5" />
    </>
  ),
  cart: stroke('M3 4h3l2.5 11h10l2-8H7M9 20h.01M18 20h.01'),
  truck: stroke('M3 6h11v10H3zM14 10h4l3 3v3h-7zM7 19h.01M17 19h.01'),
  people: stroke('M16 20v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 20v-1a3 3 0 0 0-3-3M17 5.2a3 3 0 0 1 0 5.6'),
  heart: stroke('M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z'),
  warning: stroke('M12 3l10 18H2zM12 10v5M12 18h.01'),
  leaf: stroke('M5 19C5 10 11 4 20 4c0 9-6 15-15 15zM5 19c3-5 6-8 11-11'),
  camera: () => (
    <>
      <path d="M4 8h4l2-3h4l2 3h4v11H4z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  phone: () => (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  key: () => (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
    </>
  ),
  gift: stroke('M3 8h18v4H3zM5 12v8h14v-8M12 8v12M12 8c-1-4-6-4-6-1.5S10 8 12 8zM12 8c1-4 6-4 6-1.5S14 8 12 8z'),
  undo: stroke('M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3'),
  redo: stroke('M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3'),
  fit: stroke('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
  focus: () => (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  link: stroke('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1'),
  boundary: () => <rect x="3" y="5" width="18" height="14" rx="3" strokeDasharray="3 3" />,
  find: () => (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l5 5" />
    </>
  ),
  save: stroke('M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7'),
  history: stroke('M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2'),
  activity: stroke('M3 12h4l3-8 4 16 3-8h4'),
  share: stroke('M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 10.5l4.8-2.8M8.6 13.5l4.8 2.8'),
  import: stroke('M12 3v12M7 10l5 5 5-5M4 21h16'),
  export: stroke('M12 15V3M7 8l5-5 5 5M4 21h16'),
  present: stroke('M3 4h18v12H3zM8 21l4-5 4 5'),
  eye: () => (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  tools: stroke('M4 7h16M4 12h16M4 17h16'),
  outline: stroke('M4 6h16M8 12h12M12 18h8'),
  details: stroke('M5 4h14v16H5zM9 9h6M9 13h6M9 17h3'),
  lock: () => (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  alert: stroke('M12 3l10 18H2zM12 10v5M12 18h.01'),
  plus: stroke('M12 5v14M5 12h14'),
  chevron: () => <polyline points="9 6 15 12 9 18" />,
  wifi: stroke('M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01'),
  close: stroke('M6 6l12 12M18 6L6 18'),
  next: stroke('M6 9l6 6 6-6'),
  previous: stroke('M6 15l6-6 6 6'),
};

export function Glyph(props: { name: string; size?: number }) {
  const draw = shapes[props.name] ?? shapes.question;
  const size = props.size ?? 20;
  return (
    <svg class="glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {draw?.()}
    </svg>
  );
}
