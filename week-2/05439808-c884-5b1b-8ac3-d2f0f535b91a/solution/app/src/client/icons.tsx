// One outline icon set (Lucide), inlined as SVG.
import {
  Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Gift, Hammer, House, Layers, LogOut, Pause, Play, RotateCw,
  ScrollText, Swords, Trophy, User, Users, Wrench, X,
} from 'lucide';

type IconNode = [string, Record<string, unknown>][];

const ICONS = {
  back: ChevronLeft,
  next: ChevronRight,
  back10: ChevronsLeft,
  next10: ChevronsRight,
  check: Check,
  rewards: Gift,
  build: Hammer,
  village: House,
  queues: Layers,
  signOut: LogOut,
  pause: Pause,
  play: Play,
  rotate: RotateCw,
  raidLog: ScrollText,
  raid: Swords,
  league: Trophy,
  profile: User,
  clan: Users,
  ops: Wrench,
  close: X,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  const node = ICONS[name] as IconNode;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {node.map(([tag, attrs], i) => {
        const Tag = tag as 'path';
        return <Tag key={i} {...(attrs as Record<string, string>)} />;
      })}
    </svg>
  );
}

/** The product mark: a salt pan between two tide lines. Drawn for this app. */
export function Mark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d="M4 26c5-3 9-3 14 0s9 3 14 0" fill="none" stroke="var(--teal)" stroke-width="2" stroke-linecap="round" />
      <path d="M4 32c5-3 9-3 14 0s9 3 14 0" fill="none" stroke="var(--teal)" stroke-width="2" stroke-linecap="round" />
      <path d="M10 20 20 8l10 12z" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round" />
      <path d="M15 20h10" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}

/** The quiet tide-line drawing for empty lists. */
export function TideLine() {
  return (
    <svg viewBox="0 0 120 28" aria-hidden="true" focusable="false">
      <path d="M2 14c10-8 18-8 28 0s18 8 28 0 18-8 28 0 18 8 28 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}
