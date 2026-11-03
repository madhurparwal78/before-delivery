// The procedural bean in SVG: a jelly-bean body in the player's hue with two simple eyes.
import { BEAN_BODY, hueOf } from "../shared/rules.js";

function beanColor(hue: number): string {
  return `hsl(${hue} ${BEAN_BODY.saturation}% ${BEAN_BODY.lightness}%)`;
}

export function Bean({ userId, size = 32, class: className = "" }: { userId: number; size?: number; class?: string }) {
  const hue = hueOf(userId);
  return (
    <svg class={`bean ${className}`} data-hue={hue} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path
        d="M20 3c8.6 0 14 6.4 14 15.6 0 4.6-1.4 7.4-1.4 10.6 0 4.6-4.6 7.8-12.6 7.8S7.4 33.8 7.4 29.2c0-3.2-1.4-6-1.4-10.6C6 9.4 11.4 3 20 3z"
        fill={beanColor(hue)}
        stroke="var(--ink)"
        stroke-width="2"
      />
      <circle cx="15" cy="16" r="3.2" fill="#fffaf0" stroke="var(--ink)" stroke-width="1.2" />
      <circle cx="25" cy="16" r="3.2" fill="#fffaf0" stroke="var(--ink)" stroke-width="1.2" />
      <circle cx="15.6" cy="16.6" r="1.4" fill="var(--ink)" />
      <circle cx="25.6" cy="16.6" r="1.4" fill="var(--ink)" />
    </svg>
  );
}
