// Label colours and reading copy for each flavour (drawing and words only; prices and stock
// always come from the server).

interface FlavourLook {
  label: string;
  band: string;
  ink: string;
  tagline: string;
  description: string[];
  ingredients: string;
}

export const FLAVOUR_COPY: Record<string, FlavourLook> = {
  "guava-lime": {
    label: "#e8678a",
    band: "#a9d23f",
    ink: "#2a0f18",
    tagline: "Pink guava, a squeeze of lime, bright and round.",
    description: [
      "Ripe pink guava gives this can its blush and a soft, floral sweetness. A squeeze of lime keeps it lively, and the mate underneath brings a gentle, grassy lift.",
      "It is the can we reach for on a slow morning, and the one most crates start with.",
    ],
    ingredients: "Sparkling water, organic yerba mate infusion, organic guava purée, organic lime juice, organic cane sugar, natural guava flavour.",
  },
  "yuzu-ginger": {
    label: "#f2b705",
    band: "#fff0b3",
    ink: "#2b2000",
    tagline: "Yuzu zest with a warm ginger finish.",
    description: [
      "Yuzu tastes like lemon, mandarin and grapefruit at once. We pair it with fresh-pressed ginger for a finish that warms without burning.",
      "Cold-brewed mate keeps the caffeine smooth, so the citrus does the talking.",
    ],
    ingredients: "Sparkling water, organic yerba mate infusion, organic yuzu juice, organic ginger juice, organic cane sugar, natural citrus flavour.",
  },
  "passionfruit-basil": {
    label: "#6e2e80",
    band: "#c9a2db",
    ink: "#f6eedc",
    tagline: "Tangy passionfruit and a green snap of basil.",
    description: [
      "Passionfruit brings the tang and the perfume; sweet basil adds a green, peppery snap that makes the fruit taste brighter.",
      "It is the most herbal can in the crate, and the one that pairs best with food.",
    ],
    ingredients: "Sparkling water, organic yerba mate infusion, organic passionfruit juice, organic basil extract, organic cane sugar, natural flavours.",
  },
  "cacao-orange": {
    label: "#4a2a1e",
    band: "#e8762b",
    ink: "#f6eedc",
    tagline: "Our limited drop: cacao husk and blood orange.",
    description: [
      "A small-batch drop brewed with roasted cacao husk and blood orange. Expect dark, cocoa-like depth up front and a bright, juicy finish.",
      "Each release is a fixed number of cans. When they are gone, they are gone until the next drop.",
    ],
    ingredients: "Sparkling water, organic yerba mate infusion, organic cacao husk infusion, organic blood orange juice, organic cane sugar, natural flavours.",
  },
};

export const SCENE_FLAVOURS = ["guava-lime", "yuzu-ginger", "passionfruit-basil", "cacao-orange"];
