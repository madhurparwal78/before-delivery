// Resident and satchel seed records shared by server and client rendering.
export type ResidentSeed = { resident_id: string; name: string; home: string; door: { lat: number; lon: number } };

export const RESIDENTS: readonly ResidentSeed[] = [
  { resident_id: "ottoline", name: "Ottoline Fennick", home: "Lantern Mill", door: { lat: 30, lon: 45 } },
  { resident_id: "barnaby", name: "Barnaby Sorrel", home: "Gourd House", door: { lat: -20, lon: 110 } },
  { resident_id: "pim", name: "Pim Halloway", home: "Tide Observatory", door: { lat: 60, lon: -80 } },
  { resident_id: "juniper", name: "Juniper Okafor", home: "Mossy Arch", door: { lat: -45, lon: -150 } },
];

export type SatchelSeed = { satchel_id: string; name: string; price: number; colour: string };

export const SATCHELS: readonly SatchelSeed[] = [
  { satchel_id: "canvas", name: "Canvas Satchel", price: 0, colour: "canvas" },
  { satchel_id: "riso-pink", name: "Riso Pink Satchel", price: 12, colour: "riso-pink" },
  { satchel_id: "sunpatch", name: "Sunpatch Satchel", price: 20, colour: "sunpatch" },
  { satchel_id: "night-ink", name: "Night Ink Satchel", price: 35, colour: "night-ink" },
  { satchel_id: "tidewater", name: "Tidewater Satchel", price: 50, colour: "tidewater" },
];

export const SATCHEL_COLOURS: Record<string, string> = {
  canvas: "#c8b499",
  "riso-pink": "#ff5ca8",
  sunpatch: "#ffc95c",
  "night-ink": "#5b4b8a",
  tidewater: "#1f7f7a",
};

export const EMOTES = ["wave", "cheer", "sleepy", "heart"] as const;
export type Emote = (typeof EMOTES)[number];
