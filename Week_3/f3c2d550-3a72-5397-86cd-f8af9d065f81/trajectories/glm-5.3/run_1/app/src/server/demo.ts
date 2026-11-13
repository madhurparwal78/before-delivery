// The bundled demo stops (Seed data): the same three photographs, names, makers,
// years and sizes as the Demo reel, shipped with the app and never read from the
// database or storage.

export interface DemoStop {
  title: string;
  maker: string;
  year: number;
  sizeTenths: [number, number, number];
  photoFile: string;
  about: string;
}

export const DEMO_STOPS: DemoStop[] = [
  {
    title: "Desk radio",
    maker: "Braunfeld",
    year: 1971,
    sizeTenths: [2360, 1520, 980],
    photoFile: "demo-radio.jpg",
    about: "Matte textured shell with a brushed fascia; the grille sets the rhythm.",
  },
  {
    title: "Pocket calculator",
    maker: "Orrin Electronics",
    year: 1977,
    sizeTenths: [1360, 780, 95],
    photoFile: "demo-calculator.jpg",
    about: "Two-shot PBT keycaps over an ABS frame; the satin finish hides prints.",
  },
  {
    title: "Enamel kettle",
    maker: "Halvorsen Emalje",
    year: 1964,
    sizeTenths: [2100, 1900, 1600],
    photoFile: "demo-kettle.jpg",
    about: "Gloss enamel over steel, a beech handle and no visible fasteners.",
  },
];
