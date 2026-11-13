/** The seed records of the brief: every maker, object, source and note is invented for this product. */
export const SEED_PHOTOS = new URL("../../seed/photos/", import.meta.url);

export interface SeedReference {
  file: string;
  title: string;
  maker: string;
  year: number;
  size: [number, number, number];
  materials: string[];
  finish: string;
  colour: string;
  source: { note: string } | { link: string };
  capturedAt: string;
  notes: string;
}

export const SEED_REFERENCES: SeedReference[] = [
  { file: "01-desk-radio.jpg", title: "Desk radio", maker: "Braunfeld", year: 1971, size: [2360, 1520, 980], materials: ["ABS", "aluminium"], finish: "Matte textured shell, brushed fascia", colour: "Grey", source: { note: "Flea market, Ghent" }, capturedAt: "2025-03-14T10:20:00Z", notes: "The parting line runs along the shoulder where the textured shell meets the brushed fascia." },
  { file: "02-pocket-calculator.jpg", title: "Pocket calculator", maker: "Orrin Electronics", year: 1977, size: [1360, 780, 95], materials: ["ABS", "two-shot PBT keycaps"], finish: "Satin", colour: "Black", source: { note: "Charity shop, Leeds" }, capturedAt: "2025-04-02T15:05:00Z", notes: "Two-shot keycaps keep their legends crisp, and the satin case hides fingerprints." },
  { file: "03-enamel-kettle.jpg", title: "Enamel kettle", maker: "Halvorsen Emalje", year: 1964, size: [2100, 1900, 1600], materials: ["Enamelled steel", "beech"], finish: "Gloss enamel", colour: "Orange", source: { note: "Estate sale, Aarhus" }, capturedAt: "2025-05-19T09:40:00Z", notes: "A deep persimmon orange with a slight chip at the spout lip showing black underneath." },
  { file: "04-table-fan.jpg", title: "Table fan", maker: "Vellum Appliance Co.", year: 1958, size: [2850, 3400, 1700], materials: ["Steel", "Bakelite"], finish: "Baked enamel", colour: "Green", source: { note: "Auction, Bristol" }, capturedAt: "2025-06-07T12:00:00Z", notes: "The cage welds leave a faint seam; the baked enamel is a soft sage green." },
  { file: "05-film-camera.jpg", title: "Film camera", maker: "Kestrel Optik", year: 1969, size: [1380, 860, 620], materials: ["Aluminium", "leatherette"], finish: "Satin chrome", colour: "Silver", source: { note: "Camera fair, Utrecht" }, capturedAt: "2025-07-22T08:30:00Z", notes: "Chrome top plate with a clean parting line against the leatherette body." },
  { file: "06-desk-lamp.jpg", title: "Desk lamp", maker: "Lumen & Pike", year: 1982, size: [1500, 4200, 1500], materials: ["Steel", "polycarbonate"], finish: "Powder coat, fine texture", colour: "Red", source: { note: "Studio clear-out, Glasgow" }, capturedAt: "2025-08-30T17:10:00Z", notes: "A warm signal red with a fine orange-peel texture on the arm." },
  { file: "07-wall-clock.jpg", title: "Wall clock", maker: "Hartwell Clocks", year: 1974, size: [3000, 3000, 450], materials: ["Melamine", "glass"], finish: "Matte", colour: "White", source: { note: "Flea market, Brussels" }, capturedAt: "2025-10-11T11:45:00Z", notes: "The bezel parting line is nearly invisible under the matte white melamine." },
  { file: "08-cassette-recorder.jpg", title: "Cassette recorder", maker: "Sondera", year: 1979, size: [2600, 700, 1500], materials: ["ABS", "aluminium"], finish: "Brushed and anodised", colour: "Black", source: { note: "Market stall, Lille" }, capturedAt: "2026-01-09T14:00:00Z", notes: "Brushed anodised fascia with a deep black ABS body and visible tool marks on the lid." },
  { file: "09-hair-dryer.jpg", title: "Hair dryer", maker: "Calloway Home", year: 1986, size: [2300, 2050, 820], materials: ["ABS"], finish: "Gloss", colour: "Pink", source: { note: "Charity shop, Leeds" }, capturedAt: "2026-03-27T09:15:00Z", notes: "A gloss bubblegum pink with a sharp parting line down the handle." },
  { file: "10-electric-shaver.jpg", title: "Electric shaver", maker: "Brisk", year: 1991, size: [650, 1480, 420], materials: ["ABS", "TPE overmould"], finish: "Soft-touch", colour: "Blue", source: { note: "Online auction" }, capturedAt: "2026-06-15T19:20:00Z", notes: "The TPE overmould is a dusty cobalt blue with a subtle grip texture." },
  { file: "11-telephone-handset.jpg", title: "Telephone handset", maker: "Northline Telecom", year: 1983, size: [2150, 640, 700], materials: ["ABS"], finish: "Spark-eroded texture", colour: "Beige", source: { note: "Office clearance, Manchester" }, capturedAt: "2026-09-04T10:05:00Z", notes: "Beige shell with a spark-eroded texture that has yellowed slightly near the earpiece." },
  { file: "12-bead-blasted-kettle.jpg", title: "Bead-blasted kettle", maker: "Tamsin Metalworks", year: 2024, size: [2250, 2000, 1650], materials: ["Aluminium", "phenolic"], finish: "Bead-blasted, clear anodised", colour: "Silver", source: { link: "https://tamsin-metalworks.example/kettle" }, capturedAt: "2026-11-03T10:00:00Z", notes: "Even bead-blasted grey-silver with the lid parting line sitting just under the rim." },
];

export const DEMO_REEL = ["Desk radio", "Pocket calculator", "Enamel kettle"];
export const HALDEN_KICKOFF = [
  "Enamel kettle", "Bead-blasted kettle", "Pocket calculator", "Desk radio", "Table fan", "Film camera",
  "Desk lamp", "Wall clock", "Cassette recorder", "Hair dryer", "Electric shaver", "Telephone handset",
];
export const PULL_HISTORY: [string, string][] = [
  ["2026-10-31", "Desk radio"],
  ["2026-11-01", "Pocket calculator"],
  ["2026-11-02", "Enamel kettle"],
];

