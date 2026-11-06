// One stroke icon set drawn for this app (24-unit box, 1.5 stroke, round joins). Decorative: always aria-hidden.

const PATHS: Record<string, string> = {
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7",
  alert: "M12 4l9 16H3zM12 10v4.5M12 17.5v.01",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.01",
  chevron: "M7 10l5 5 5-5",
  menu: "M4 7h16M4 12h16M4 17h10",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  plus: "M12 5v14M5 12h14",
  signout: "M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10",
  cases: "M4 12h11M11 7l5 5-5 5M19 5v14",
  review: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5",
  messages: "M3 13l3-8h12l3 8v6H3zM3 13h5l1.5 2.5h5L16 13h5",
  counterparties: "M4 20V8l8-4 8 4v12M9 20v-6h6v6M3 20h18",
  rules: "M12 4v16M5 8h14M5 8l-2.5 6a3 3 0 005 0zM19 8l-2.5 6a3 3 0 005 0zM8 20h8",
  report: "M5 5h14v15H5zM5 9h14M9 3v4M15 3v4M8.5 13h2M13.5 13h2M8.5 16.5h2",
  months: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 15.5h3",
  files: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 15.5h5",
  keys: "M14.5 4a5.5 5.5 0 11-4.9 8l-6.1 6.1V21h3v-2h2v-2h2l1.4-1.4A5.5 5.5 0 0114.5 4zM16 8.5v.01",
  members: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.5a3.5 3.5 0 010 6.5M18 14.8c2 .7 3.2 2.6 3.5 5.2",
  listing: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z",
  ring: "M12 20a8 8 0 100-16 8 8 0 000 16z",
  lantern: "M9 3h6M10 3v2M14 3v2M7 8a5 5 0 0110 0v8a5 5 0 01-10 0zM7 12h10M12 21v-0.5",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
