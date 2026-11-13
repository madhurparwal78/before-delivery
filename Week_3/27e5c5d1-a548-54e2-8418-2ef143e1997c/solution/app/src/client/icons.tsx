import type { ReactElement, ReactNode } from 'react';

function Icon({ children, label }: { children: ReactNode; label?: string }): ReactElement {
  return (
    <svg
      className="icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false })}
    >
      {children}
    </svg>
  );
}

export const LockIcon = ({ label }: { label?: string }): ReactElement => (
  <Icon {...(label ? { label } : {})}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);
export const EllipsisIcon = (): ReactElement => (
  <Icon>
    <circle cx="5.5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="18.5" cy="12" r="1" />
  </Icon>
);
export const PlusIcon = (): ReactElement => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const KeyboardIcon = (): ReactElement => (
  <Icon>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
  </Icon>
);
export const CloseIcon = (): ReactElement => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const ChevronIcon = (): ReactElement => (
  <Icon>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const SearchIcon = (): ReactElement => (
  <Icon>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
);
export const MenuIcon = (): ReactElement => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
export const PaperclipIcon = (): ReactElement => (
  <Icon>
    <path d="m20 11-8.6 8.6a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L14 7" />
  </Icon>
);
export const CheckIcon = (): ReactElement => (
  <Icon>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const SettingsIcon = (): ReactElement => (
  <Icon>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
);

/** A larkspur sprig, drawn for the empty states. */
export function Sprig(): ReactElement {
  return (
    <svg className="sprig" width="72" height="88" viewBox="0 0 72 88" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M36 84V14" />
      <path d="M36 70c-8-2-13-8-14-15M36 62c8-2 13-8 14-15M36 50c-7-2-11-7-12-13M36 42c7-2 11-7 12-13" />
      <path d="M36 14c-5-1-8-5-8-9 5 0 8 3 8 9ZM36 14c5-1 8-5 8-9-5 0-8 3-8 9Z" />
      <circle cx="22" cy="55" r="3" />
      <circle cx="50" cy="47" r="3" />
      <circle cx="24" cy="37" r="3" />
      <circle cx="48" cy="29" r="3" />
    </svg>
  );
}
