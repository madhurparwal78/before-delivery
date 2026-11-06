const GEOMETRY = {
  clock: <>
    <circle cx="12" cy="12" r="8.25" />
    <path d="M12 7.5v4.9l3.4 2.1" />
  </>,
  calendar: <>
    <rect x="3.75" y="5.25" width="16.5" height="15" rx="2.25" />
    <path d="M3.75 10.5h16.5M8.25 3.75v3M15.75 3.75v3" />
  </>,
  check: <path d="M4.5 12.75 9.75 18 19.5 6.75" />,
  cross: <path d="M6 6l12 12M18 6 6 18" />,
  bar: <path d="M4.5 12h15" />,
  slash: <path d="M6.75 19.5 17.25 4.5" />,
  'chevron-down': <path d="M5.25 9 12 15.75 18.75 9" />,
  'chevron-right': <path d="M9 5.25 15.75 12 9 18.75" />,
  search: <>
    <circle cx="10.5" cy="10.5" r="6.75" />
    <path d="M15.4 15.4 20.25 20.25" />
  </>,
  filter: <path d="M3.75 6h16.5M6.75 12h10.5M10.5 18h3" />,
  user: <>
    <circle cx="12" cy="8.25" r="3.75" />
    <path d="M4.5 20.25a7.5 7.5 0 0 1 15 0" />
  </>,
  shield: <path d="M12 3.75l7.5 2.7v5.4c0 4.4-3 7.6-7.5 8.4-4.5-.8-7.5-4-7.5-8.4v-5.4z" />,
  bell: <>
    <path d="M6.75 10.5a5.25 5.25 0 0 1 10.5 0c0 3.6.9 5.1 1.5 6H5.25c.6-.9 1.5-2.4 1.5-6z" />
    <path d="M9.75 19.5a2.4 2.4 0 0 0 4.5 0" />
  </>,
  exit: <>
    <path d="M14.25 7.5V4.5h-9v15h9v-3" />
    <path d="M10.5 12h9.75M17.25 8.25 20.25 12l-3 3.75" />
  </>,
  plus: <path d="M12 5.25v13.5M5.25 12h13.5" />,
  link: <>
    <path d="M10.5 13.5a3.75 3.75 0 0 0 5.3 0l2.6-2.6a3.75 3.75 0 0 0-5.3-5.3l-1 1" />
    <path d="M13.5 10.5a3.75 3.75 0 0 0-5.3 0l-2.6 2.6a3.75 3.75 0 0 0 5.3 5.3l1-1" />
  </>,
  download: <>
    <path d="M12 3.75v11.5M7.5 11.25 12 15.75l4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </>,
};

/** Inline vector geometry on one square canvas, stroked in the colour of the text beside it. */
export function Icon({ name, size = 18, className }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GEOMETRY[name]}
    </svg>
  );
}
