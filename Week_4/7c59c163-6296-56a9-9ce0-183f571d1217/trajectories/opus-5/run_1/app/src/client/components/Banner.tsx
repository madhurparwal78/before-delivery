/** Error and outage banners are blush cards with an ink Lucide icon and the exact published copy. */
export function Banner(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="banner" role="alert">
      <AlertIcon />
      <span>{props.children}</span>
    </div>
  );
}

/** Lucide `triangle-alert`, drawn inline so nothing is fetched at runtime. */
function AlertIcon(): React.JSX.Element {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
