import { useId } from "react";

/** Luminous ring art: a decorative radial glow, a blurred and a crisp ring, and two tangent streaks. */
export function Ring() {
  const id = useId();
  return (
    <svg className="ring" viewBox="0 0 330 330" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#8B7CF6" stopOpacity="0.28" />
          <stop offset="1" stopColor="#040207" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FDFCFF" />
          <stop offset="0.5" stopColor="#C9C2FF" />
          <stop offset="1" stopColor="#8B7CF6" stopOpacity="0" />
        </linearGradient>
        <filter id={`${id}-blur`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <circle cx="165" cy="165" r="160" fill={`url(#${id}-glow)`} />
      <circle cx="165" cy="165" r="96" fill="none" stroke={`url(#${id}-stroke)`} strokeWidth="9" filter={`url(#${id}-blur)`} opacity="0.9" />
      <circle cx="165" cy="165" r="96" fill="none" stroke={`url(#${id}-stroke)`} strokeWidth="2.5" />
      <ellipse cx="165" cy="165" rx="132" ry="58" fill="none" stroke="#C9C2FF" strokeWidth="0.8" opacity="0.5" transform="rotate(-24 165 165)" />
      <path d="M40 232C100 200 214 130 292 96" fill="none" stroke="#FDFCFF" strokeWidth="1" opacity="0.7" />
      <path d="M60 262C124 226 232 160 300 132" fill="none" stroke="#8B7CF6" strokeWidth="0.8" opacity="0.6" />
    </svg>
  );
}
