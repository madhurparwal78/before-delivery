interface IconProps {
  className?: string;
}

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
  'aria-hidden': true,
  focusable: 'false'
};

export function ChevronDown({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <path d="M6 9.5 12 15.5 18 9.5" />
    </svg>
  );
}

export function ChevronRight({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <path d="M9.5 6 15.5 12 9.5 18" />
    </svg>
  );
}

export function MenuLines({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function MagnifyingGlass({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 3.5 3.5" />
    </svg>
  );
}

export function CopySheets({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15" />
    </svg>
  );
}

export function InfoCircle({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 8.2v.2" />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function PlusMark({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

export function CrossMark({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
    </svg>
  );
}

export function RefreshMark({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <path d="M19 10.5A7 7 0 0 0 6.6 7.4L5 9" />
      <path d="M5 5v4h4" />
      <path d="M5 13.5A7 7 0 0 0 17.4 16.6L19 15" />
      <path d="M19 19v-4h-4" />
    </svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h3.2a1.5 1.5 0 0 1 1.2.6l1 1.4h7.6A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" />
    </svg>
  );
}

export function CoinIcon({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M9.5 10h5M9.5 14h5" />
    </svg>
  );
}

export function PeopleIcon({ className }: IconProps) {
  return (
    <svg {...base} class={`icon ${className ?? ''}`}>
      <circle cx="9" cy="9" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.5a3 3 0 0 1 0 5.8" />
      <path d="M17.5 14.5a5.5 5.5 0 0 1 3 4.5" />
    </svg>
  );
}
