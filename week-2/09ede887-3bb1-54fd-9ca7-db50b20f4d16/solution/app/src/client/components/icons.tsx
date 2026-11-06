import type { ReactNode } from 'react';

// Single-colour outline icons in the current text colour, drawn for this app.

interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg className={className ? `icon ${className}` : 'icon'} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square">
        {children}
      </g>
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3l10 10M13 3L3 13" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 1.5v4.5M8 10v4.5M1.5 8H6M10 8h4.5" />
    </Svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6l5 5M8 11l5-5" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6.75" cy="6.75" r="4.75" />
      <path d="M10.5 10.5l4 4" />
    </Svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 5.5h13M1.5 10.5h13" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 8.5l3.5 3.5 7.5-8" />
    </Svg>
  );
}
