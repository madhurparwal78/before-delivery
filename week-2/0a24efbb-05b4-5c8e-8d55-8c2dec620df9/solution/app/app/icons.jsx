// The desk's icon set: one 24-unit square canvas, one stroke weight, round ends and joins, no fill.
const SHAPES = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cross: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  bar: <path d="M5 12h14" />,
  slash: <path d="M7.5 19L16.5 5" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.4-4.4" />
    </>
  ),
  filter: <path d="M4 7h16M7 12h10M10 17h4" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5" />
    </>
  ),
  shield: <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" />,
  bell: <path d="M6.5 16.5v-5a5.5 5.5 0 0111 0v5l1.5 1.5h-14zM10 21h4" />,
  exit: <path d="M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h10" />,
  plus: <path d="M12 5v14M5 12h14" />,
  link: <path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1" />,
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
};

export function Icon({ name, size = 18, className = "" }) {
  return (
    <svg
      className={`glyph ${className}`.trim()}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
