/** The wrung-cloth mascot: a cloth twisted tight at the waist. */
export function Mascot({ size = 22 }: { size?: number }) {
  return (
    <svg className="mascot" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M3 7l10 5c2 1 4 1 6 0l10-5v18l-10-5c-2-1-4-1-6 0L3 25z" fill="currentColor" />
      <path d="M13 12.2l5.6 7.6M18 12l-5 7.8" fill="none" stroke="var(--mascot-crease, #34853a)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
