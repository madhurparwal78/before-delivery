export type IconName = 'draft' | 'review' | 'clock' | 'live' | 'blocked' | 'dormant' | 'warning' | 'check';

const paths: Record<IconName, JSX.Element> = {
  draft: <path d="M2 10l6-6 2 2-6 6H2v-2z" />,
  review: <circle cx="6" cy="6" r="4" />,
  clock: <path d="M6 1a5 5 0 100 10A5 5 0 006 1zm.5 2v3l2 1-.5 1-2.5-1.2V3h1z" />,
  live: <circle cx="6" cy="6" r="5" />,
  blocked: <path d="M6 1a5 5 0 100 10A5 5 0 006 1zm0 1.5c.8 0 1.5.2 2.1.6L3.1 8.1A3.5 3.5 0 016 2.5zm0 7a3.5 3.5 0 01-2.1-.6l5-5A3.5 3.5 0 016 9.5z" />,
  dormant: <circle cx="6" cy="6" r="4" fill="none" strokeWidth="1.5" stroke="currentColor" />,
  warning: <path d="M6 1l5 9H1l5-9zm0 3v3h1V4H6zm0 4v1h1V8H6z" />,
  check: <path d="M4.6 9.4L1.8 6.6l1-1 1.8 1.8 4.6-4.6 1 1z" />,
};

/** A small mark that pairs with a word, so a state never leans on colour alone. */
export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
