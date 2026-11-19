export type IconName =
  | "chevron"
  | "search"
  | "external"
  | "plus"
  | "tick"
  | "cross"
  | "lines"
  | "copy"
  | "database";

const PATHS: Record<IconName, string> = {
  chevron: "M4 7l4 4 4-4",
  search: "M11.5 11.5L14 14M7 11a4 4 0 100-8 4 4 0 000 8z",
  external: "M6 10l5-5M11 5H7m4 0v4",
  plus: "M8 4v8M4 8h8",
  tick: "M3.5 8.5l3 3 6-7",
  cross: "M4 4l8 8M12 4l-8 8",
  lines: "M3 5h10M3 8h10M3 11h10",
  copy: "M5.5 5.5h6v6h-6zM4 10V4h6",
  database: "M8 3c2.8 0 5 .7 5 1.6S10.8 6.2 8 6.2 3 5.5 3 4.6 5.2 3 8 3zm5 3.4v2c0 .9-2.2 1.6-5 1.6s-5-.7-5-1.6v-2m10 3.6v1.8c0 .9-2.2 1.6-5 1.6s-5-.7-5-1.6V10",
};

/** Inline line glyphs drawn in the current text colour. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo(): JSX.Element {
  return (
    <>
      <svg aria-hidden="true" focusable="false" width="26" height="26" viewBox="0 0 32 32" fill="none">
        <path
          d="M4 22c6-14 12 4 18-10"
          stroke="var(--violet)"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <path d="M6 10c7 2 13 10 20 10" stroke="var(--pink)" strokeWidth="2.2" strokeLinecap="round" opacity="0.8" />
      </svg>
      <span>Wayline</span>
    </>
  );
}
