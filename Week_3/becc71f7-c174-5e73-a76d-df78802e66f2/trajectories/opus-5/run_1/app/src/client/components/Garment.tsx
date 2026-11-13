import type { Category } from '../../shared/options.js';

/** A deterministic small variation per piece, so every drawing is its own. */
function seedOf(key: string): number {
  let value = 0;
  for (const character of key) value = (value * 31 + character.charCodeAt(0)) % 9973;
  return value;
}

const SILHOUETTES: Record<Category, (sway: number) => string> = {
  coats: (s) => `M50 38 L34 46 L${22 + s} 116 L40 122 L40 170 L100 170 L100 122 L${118 - s} 116 L106 46 L90 38 L70 50 Z`,
  jackets: (s) => `M50 38 L34 46 L${24 + s} 104 L42 110 L42 142 L98 142 L98 110 L${116 - s} 104 L106 46 L90 38 L70 50 Z`,
  dresses: (s) => `M52 38 L44 48 L50 92 L${30 + s} 176 L${110 - s} 176 L90 92 L96 48 L88 38 L70 48 Z`,
  knitwear: (s) => `M50 38 L32 48 L${24 + s} 100 L44 106 L44 136 L96 136 L96 106 L${116 - s} 100 L108 48 L90 38 L70 48 Z`,
  shirts: (s) => `M52 38 L38 46 L${30 + s} 96 L46 100 L46 134 L94 134 L94 100 L${110 - s} 96 L102 46 L88 38 L70 50 Z`,
  trousers: (s) => `M48 40 L92 40 L${94 - s} 176 L76 176 L70 96 L64 176 L${46 + s} 176 Z`,
  skirts: (s) => `M50 44 L90 44 L${104 - s} 150 L${36 + s} 150 Z`,
  shoes: (s) => `M34 132 Q34 108 56 108 L66 108 L74 124 L${104 + s} 136 Q112 142 104 150 L40 150 Q32 146 34 132 Z`,
  bags: (s) => `M44 78 L96 78 L${102 + s} 150 L${38 - s} 150 Z M56 78 Q56 52 70 52 Q84 52 84 78`,
  accessories: (s) => `M42 56 Q70 ${44 + s} 98 56 Q86 92 98 150 Q70 140 42 150 Q54 92 42 56 Z`,
};

const HANGING: ReadonlySet<Category> = new Set<Category>([
  'coats',
  'jackets',
  'dresses',
  'knitwear',
  'shirts',
  'trousers',
  'skirts',
]);

interface GarmentProps {
  category: Category;
  seed: string;
  /** A featured tile in the Categories menu is drawn a little plainer. */
  tile?: boolean;
}

/** All imagery is generated: a garment on a hanger, drawn from the piece's own key. */
export function Garment({ category, seed, tile = false }: GarmentProps) {
  const sway = seedOf(seed) % 7;
  const fold = 60 + (seedOf(`${seed}f`) % 40);
  const silhouette = (SILHOUETTES[category] ?? SILHOUETTES.coats)(sway);
  return (
    <svg
      class={`garment ${tile ? 'garment--tile' : ''}`}
      viewBox="0 0 140 190"
      role="presentation"
      focusable="false"
    >
      <rect x="0" y="0" width="140" height="190" class="garment__ground" />
      {HANGING.has(category) ? (
        <g class="garment__hanger">
          <path d="M70 14 Q70 6 76 6 Q82 6 82 12" />
          <path d="M70 14 L70 22" />
          <path d="M70 22 L34 44 M70 22 L106 44" />
          <path d="M34 44 L106 44" />
        </g>
      ) : null}
      <path class="garment__body" d={silhouette} />
      <path class="garment__fold" d={`M52 ${fold} Q70 ${fold + 10} 88 ${fold}`} />
      <path class="garment__fold" d={`M54 ${fold + 22} Q70 ${fold + 30} 86 ${fold + 22}`} />
    </svg>
  );
}
