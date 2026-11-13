// Written by scripts/build.mjs. The landing page plays these three stops with no
// help from the database or the object store.
export interface DemoStop {
  slug: string;
  title: string;
  maker: string;
  year: number;
  size_line: string;
  swatch: string;
  photo_url: string;
  blurb: string;
}

export const DEMO_STOPS: readonly DemoStop[] = [
  {
    "slug": "desk-radio",
    "title": "Desk radio",
    "maker": "Braunfeld",
    "year": 1971,
    "size_line": "236.0 × 152.0 × 98.0 mm",
    "swatch": "#878784",
    "photo_url": "/assets/objects/desk-radio.png",
    "blurb": "A textured shell against a brushed fascia, the pairing most desk objects of the period settled on."
  },
  {
    "slug": "pocket-calculator",
    "title": "Pocket calculator",
    "maker": "Orrin Electronics",
    "year": 1977,
    "size_line": "136.0 × 78.0 × 9.5 mm",
    "swatch": "#403f40",
    "photo_url": "/assets/objects/pocket-calculator.png",
    "blurb": "Two-shot keycaps on a satin body: legends that outlive the case they sit in."
  },
  {
    "slug": "enamel-kettle",
    "title": "Enamel kettle",
    "maker": "Halvorsen Emalje",
    "year": 1964,
    "size_line": "210.0 × 190.0 × 160.0 mm",
    "swatch": "#e2854f",
    "photo_url": "/assets/objects/enamel-kettle.png",
    "blurb": "Gloss enamel over pressed steel, with a beech handle that keeps its warmth in the hand."
  }
];
