function hash(seed: string): number {
  let value = 2166136261;
  for (const character of seed) {
    value ^= character.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value);
}

const round = (value: number): string => value.toFixed(1);

function pipetteRack(variation: number): string[] {
  const parts = ['<rect x="18" y="64" width="64" height="10" />'];
  const count = 4 + (variation % 3);
  for (let index = 0; index < count; index += 1) {
    const x = round(24 + index * (52 / Math.max(1, count - 1)));
    const top = 22 + (index % 2) * 6;
    parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="64" />`);
    parts.push(`<circle cx="${x}" cy="${top - 2}" r="3" />`);
  }
  return parts;
}

function flask(variation: number): string[] {
  const neck = 16 + (variation % 5);
  return [
    '<line x1="42" y1="20" x2="58" y2="20" />',
    `<line x1="44" y1="20" x2="44" y2="${20 + neck}" />`,
    `<line x1="56" y1="20" x2="56" y2="${20 + neck}" />`,
    `<path d="M44 ${20 + neck} L26 74 L74 74 L56 ${20 + neck}" />`,
    '<line x1="32" y1="62" x2="68" y2="62" />',
  ];
}

function centrifugeRotor(variation: number): string[] {
  const parts = ['<circle cx="50" cy="50" r="30" />', '<circle cx="50" cy="50" r="6" />'];
  const wells = 6 + (variation % 3);
  for (let index = 0; index < wells; index += 1) {
    const angle = (index / wells) * Math.PI * 2;
    parts.push(`<circle cx="${round(50 + Math.cos(angle) * 19)}" cy="${round(50 + Math.sin(angle) * 19)}" r="5" />`);
  }
  return parts;
}

/** Vector glassware drawn by the app from the company or role name. */
export function glasswareSvg(seed: string): Element {
  const value = hash(seed);
  const builders = [pipetteRack, flask, centrifugeRotor];
  const builder = builders[value % 3] as (variation: number) => string[];
  const holder = document.createElement('div');
  holder.innerHTML = [
    '<svg viewBox="0 0 100 100" class="glassware" aria-hidden="true" focusable="false">',
    '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.78">',
    ...builder(Math.floor(value / 3)),
    '</g></svg>',
  ].join('');
  return holder.firstElementChild as Element;
}
