/** The Quarkyard mark: an outlined cube drawn by the app, white on the header bar. */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16 6.5 25 11.5v9L16 25.5 7 20.5v-9z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M7 11.5 16 16.5l9-5M16 16.5v9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
