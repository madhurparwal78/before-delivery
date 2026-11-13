import type { ReactNode } from "react";

/** The drawn icon set: one 1.5 unit stroke on a 20 unit grid, and the match from the matchbox. Decorative beside their words. */

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 20 20" className="icon" aria-hidden="true" focusable="false">{children}</svg>
);

export const ArrowIcon = () => (
  <Icon>
    <path d="M17 10H3.5M8.5 5l-5 5 5 5" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M4.5 4.5l11 11M15.5 4.5l-11 11" />
  </Icon>
);

export const SoundIcon = ({ on }: { on: boolean }) => (
  <Icon>
    <path d="M3 7.75v4.5h3l4.5 3.5V4.25L6 7.75z" />
    {on ? <path d="M13.25 7.25a4 4 0 0 1 0 5.5M15.5 5a7 7 0 0 1 0 10" /> : <path d="M13.5 8l4 4M17.5 8l-4 4" />}
  </Icon>
);

export const MatchIcon = () => (
  <svg viewBox="0 0 40 16" className="matchbox__icon" aria-hidden="true" focusable="false">
    <path d="M1 8.6 L1 7.4 L31 6.6 L31 9.4 Z" className="matchbox__stick" />
    <ellipse cx="34" cy="8" rx="5" ry="6" className="matchbox__head" />
  </svg>
);
