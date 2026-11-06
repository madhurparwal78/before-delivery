// Inline vector geometry, one shared stroke weight, round ends and joins.
// No fill, no sprite, no image request. Stroked in the colour of the text
// beside it via currentColor.

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

export function ClockIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function CalendarIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 2.8v4M16 2.8v4" />
    </svg>
  );
}

export function CheckIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

export function CrossIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />
    </svg>
  );
}

export function BarIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 12h15" />
    </svg>
  );
}

export function SlashIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 19L19 5" />
    </svg>
  );
}

export function ChevronDownIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5.5 9.5L12 16l6.5-6.5" />
    </svg>
  );
}

export function ChevronIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.5 15.5L20.5 20.5" />
    </svg>
  );
}

export function FilterIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6.5h16M7 12h10M10 17.5h4" />
    </svg>
  );
}

export function UserIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8.2" r="4.2" />
      <path d="M4.5 20.5c1.7-4 4.4-5.8 7.5-5.8s5.8 1.8 7.5 5.8" />
    </svg>
  );
}

export function ShieldIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3l7 3v5.5c0 4.7-3 8.2-7 9.5-4-1.3-7-4.8-7-9.5V6z" />
    </svg>
  );
}

export function BellIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M6 16.5v-6a6 6 0 0 1 12 0v6M4.5 16.5h15M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

export function ExitIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M14 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h8M12.5 12h8m0 0l-3-3m3 3l-3 3" />
    </svg>
  );
}

export function PlusIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function LinkIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1.5 1.5" />
      <path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6L12.5 17.5" />
    </svg>
  );
}

export function DownloadIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v11m0 0l-4-4m4 4l4-4M4.5 19.5h15" />
    </svg>
  );
}

// State chip glyphs and calendar marks reuse the geometry above.
export const STATE_GLYPH = {
  pending: BarIcon,
  approved: CheckIcon,
  rejected: CrossIcon,
  cancelled: SlashIcon,
};

export const MARK_GLYPH = {
  recorded: CheckIcon,
  incomplete: ClockIcon,
  leave_approved: CalendarIcon,
  leave_pending: BarIcon,
  waiting: BellIcon,
};

export const MARK_LABEL = {
  recorded: 'Attendance recorded',
  incomplete: 'Attendance incomplete',
  leave_approved: 'Leave approved',
  leave_pending: 'Leave pending',
  waiting: 'Correction waiting',
};

export const STATE_LABEL = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
