/** The Drowsewyrm asleep: a coiled body, a closed eye and drifting z marks, in flat blush lines and fills. */
export function Serpent() {
  return (
    <svg className="serpent" role="img" aria-label="The Drowsewyrm, a sleepy serpent" viewBox="0 0 480 270">
      <g fill="none" stroke="var(--blush)" strokeLinecap="round" strokeLinejoin="round">
        <path d="M26 226 C 70 150, 140 270, 206 200 S 318 118, 352 188 S 392 228, 428 196" strokeWidth="26" />
        <path d="M26 226 C 70 150, 140 270, 206 200 S 318 118, 352 188 S 392 228, 428 196" stroke="var(--ink)" strokeWidth="5" strokeDasharray="1 17" />
        <path d="M20 232 L 6 246" strokeWidth="10" />
        <path d="M392 96 l 22 0 l -22 26 l 22 0" strokeWidth="6" />
        <path d="M424 58 l 16 0 l -16 20 l 16 0" strokeWidth="5" />
        <path d="M450 28 l 11 0 l -11 14 l 11 0" strokeWidth="4" />
      </g>
      <ellipse cx="404" cy="168" rx="52" ry="36" fill="var(--blush)" />
      <path d="M470 178 l 8 -4 M470 178 l 8 4" stroke="var(--blush)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M382 160 q 12 10 26 0" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" fill="none" />
      <circle cx="446" cy="164" r="4" fill="var(--ink)" />
      <path d="M452 184 l 22 0" stroke="var(--blush)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
