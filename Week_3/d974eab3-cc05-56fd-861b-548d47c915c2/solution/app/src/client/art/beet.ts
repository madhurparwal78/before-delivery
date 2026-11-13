/** A beet root drawn in beet red with a hairline leaf stalk; `pose` positions it inside a larger drawing. */
export function beetMarkup(pose: string): string {
  return `<g transform="${pose}">
    <path class="stroke-line" fill="none" stroke-width="2" stroke-linecap="round" d="M0 -58 C-6 -78 -4 -92 -12 -108 M0 -58 C4 -80 10 -90 16 -104 M0 -58 C-2 -72 0 -86 2 -112"/>
    <path class="fill-beet" d="M0 -60 C34 -62 56 -32 46 2 C40 26 18 48 3 74 C2 78 -2 78 -3 74 C-18 48 -40 26 -46 2 C-56 -32 -34 -62 0 -60 Z"/>
    <path class="stroke-paper" fill="none" stroke-width="1.5" stroke-opacity=".55" d="M-30 -30 C-14 -18 14 -18 30 -30 M-34 -8 C-14 6 14 6 34 -8 M-26 16 C-10 26 10 26 26 16"/>
  </g>`;
}
