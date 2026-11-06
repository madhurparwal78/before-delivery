// Thin line icons drawn for this app: 1.5 px strokes in the current text colour, no fills.
import type { JSX } from 'preact';

type IconProps = { size?: number; class?: string };

function Icon({ size = 18, class: className, children }: IconProps & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg
      class={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronDown = (p: IconProps) => <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>;
export const ChevronRight = (p: IconProps) => <Icon {...p}><path d="m9 6 6 6-6 6" /></Icon>;
export const MenuIcon = (p: IconProps) => <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>;
export const Search = (p: IconProps) => <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Icon>;
export const Copy = (p: IconProps) => (
  <Icon {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></Icon>
);
export const Info = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Icon>;
export const Home = (p: IconProps) => <Icon {...p}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></Icon>;
export const Plus = (p: IconProps) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const Close = (p: IconProps) => <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const Refresh = (p: IconProps) => (
  <Icon {...p}><path d="M19.5 9A8 8 0 0 0 5.2 7.5L4 9" /><path d="M4 4.5V9h4.5" /><path d="M4.5 15a8 8 0 0 0 14.3 1.5L20 15" /><path d="M20 19.5V15h-4.5" /></Icon>
);
export const Folder = (p: IconProps) => <Icon {...p}><path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></Icon>;
export const Coins = (p: IconProps) => (
  <Icon {...p}><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" /><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></Icon>
);
export const People = (p: IconProps) => (
  <Icon {...p}><circle cx="9" cy="8.5" r="3.5" /><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.8c1.8.6 3 2.2 3.5 4.7" /></Icon>
);
export const Check = (p: IconProps) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
