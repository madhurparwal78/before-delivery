const PATHS = {
  save: <path d="M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  fork: (
    <>
      <circle cx="7" cy="5" r="2" />
      <circle cx="17" cy="5" r="2" />
      <circle cx="12" cy="19" r="2" />
      <path d="M7 7v2a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V7 M12 12v5" />
    </>
  ),
  share: <path d="M12 4v11 M8 8l4-4 4 4 M5 14v5h14v-5" />,
  history: <path d="M4 12a8 8 0 1 0 3-6.2 M4 4v4h4 M12 8v4l3 2" />,
  download: <path d="M12 4v11 M8 11l4 4 4-4 M5 19h14" />,
  settings: <path d="M4 7h10 M18 7h2 M4 17h2 M10 17h10 M16 5v4 M8 15v4" />,
  plus: <path d="M12 5v14 M5 12h14" />,
  close: <path d="M6 6l12 12 M18 6L6 18" />,
  trash: <path d="M5 7h14 M9 7V4h6v3 M7 7l1 13h8l1-13" />,
  menu: <path d="M4 7h16 M4 12h16 M4 17h16" />,
  rerun: <path d="M20 12a8 8 0 1 1-3-6.2 M20 4v4h-4" />,
} as const;

type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }): React.JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function CourseDrawing(): React.JSX.Element {
  return (
    <svg className="course" viewBox="0 0 96 48" width="96" height="48" aria-hidden="true">
      <rect x="0" y="36" width="40" height="12" fill="var(--band-b)" />
      <rect x="42" y="36" width="54" height="12" fill="var(--band-a)" />
      <rect x="10" y="23" width="50" height="12" fill="var(--band-a)" />
      <rect x="62" y="23" width="26" height="12" fill="var(--accent)" />
      <rect x="22" y="10" width="30" height="12" fill="var(--band-b)" />
    </svg>
  );
}
