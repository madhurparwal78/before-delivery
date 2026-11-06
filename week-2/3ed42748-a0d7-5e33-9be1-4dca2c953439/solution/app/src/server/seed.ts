// Seed data from the brief: Bramble, its residents, the opening missions, satchels and couriers.

export const RADIUS_M = 60;
export const DEPOT = { lat: 0, lon: 0 };
export const DOOR_DISTANCE_M = 4.0;
export const SEED_TIME_ZONE = "America/Vancouver";

interface Resident {
  id: string;
  name: string;
  home: string;
  door: { lat: number; lon: number };
}

export const RESIDENTS: readonly Resident[] = [
  { id: "ottoline", name: "Ottoline Fennick", home: "Lantern Mill", door: { lat: 30, lon: 45 } },
  { id: "barnaby", name: "Barnaby Sorrel", home: "Gourd House", door: { lat: -20, lon: 110 } },
  { id: "pim", name: "Pim Halloway", home: "Tide Observatory", door: { lat: 60, lon: -80 } },
  { id: "juniper", name: "Juniper Okafor", home: "Mossy Arch", door: { lat: -45, lon: -150 } },
];

export const residentById = (id: string): Resident | undefined => RESIDENTS.find((r) => r.id === id);

interface Satchel {
  id: string;
  name: string;
  price: number;
}

export const SATCHELS: readonly Satchel[] = [
  { id: "canvas", name: "Canvas Satchel", price: 0 },
  { id: "riso-pink", name: "Riso Pink Satchel", price: 12 },
  { id: "sunpatch", name: "Sunpatch Satchel", price: 20 },
  { id: "night-ink", name: "Night Ink Satchel", price: 35 },
  { id: "tidewater", name: "Tidewater Satchel", price: 50 },
];

export const satchelById = (id: string): Satchel | undefined => SATCHELS.find((s) => s.id === id);
export const STARTING_SATCHEL = "canvas";

export const SEED_MISSIONS = [
  {
    id: "lantern-oil",
    title: "Lantern oil for the mill",
    resident: "ottoline",
    reward: 5,
    kind: "standard",
    rushSlots: null,
    status: "live",
    offer: ["The mill lamps are sputtering again.", "Bring me a tin of lantern oil from the depot, would you?"],
    thanks: ["Bright as noon. Here, take these stamps."],
  },
  {
    id: "seed-packets",
    title: "Seed packets for the gourds",
    resident: "barnaby",
    reward: 4,
    kind: "standard",
    rushSlots: null,
    status: "live",
    offer: ["My gourds want company.", "Fetch the seed packets with the blue string."],
    thanks: ["They'll be climbing the fence by spring."],
  },
  {
    id: "star-chart",
    title: "A rolled star chart",
    resident: "pim",
    reward: 8,
    kind: "standard",
    rushSlots: null,
    status: "live",
    offer: ["The tide charts are fine, but the star charts are late.", "Mind the tube — it's older than the observatory."],
    thanks: ["Perfect. Tonight we count comets."],
  },
  {
    id: "moonmelon-express",
    title: "Moonmelon Express",
    resident: "juniper",
    reward: 15,
    kind: "rush",
    rushSlots: 1,
    status: "live",
    offer: ["A moonmelon is only sweet for an hour.", "Run it to Mossy Arch before it sulks!"],
    thanks: ["Still cold! You're the fastest on Bramble."],
  },
  {
    id: "kite-string",
    title: "Kite string for the mill",
    resident: "ottoline",
    reward: 6,
    kind: "standard",
    rushSlots: null,
    status: "draft",
    offer: ["The wind finally turned.", "I need the long spool of kite string."],
    thanks: ["Up she goes. Thank you, courier."],
  },
] as const;

export const SEED_COURIERS = [
  { email: "wren@kitefold.example", name: "Wren", role: "founder", deliveries: [] },
  { email: "odile@kitefold.example", name: "Odile", role: "helper", deliveries: [] },
  {
    email: "tamsin@example.com",
    name: "Tamsin",
    role: "courier",
    deliveries: [
      { missionId: "star-chart", reward: 8 },
      { missionId: "moonmelon-express", reward: 15 },
    ],
  },
  { email: "ravi@example.com", name: "Ravi", role: "courier", deliveries: [] },
] as const;
