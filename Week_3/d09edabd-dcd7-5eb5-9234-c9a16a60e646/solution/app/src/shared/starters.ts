import type { NodeKind, PlacementKind } from './types.js';

export interface StarterPlacement {
  kind: PlacementKind;
  label: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotation?: number;
}

export interface StarterNode {
  title: string;
  kind: NodeKind;
  needs?: string[];
  placement?: string;
  answer?: string;
}

export interface StarterRoom {
  name: string;
  starter: boolean;
  size: [number, number, number];
  placements: StarterPlacement[];
  nodes: StarterNode[];
}

const door = (label: string, x: number, h = 2100): StarterPlacement => ({ kind: 'door', label, x, z: 0, w: 900, d: 100, h });

/** The seed rooms (Lantern Lane and every new venue), and the Vault the public tour walks through. */
export const STARTER_ROOMS: StarterRoom[] = [
  {
    name: 'Apothecary', starter: true, size: [4000, 3500, 2700],
    placements: [
      door('Entry door', 2000),
      { kind: 'box', label: 'Herb cabinet', x: 3300, z: 3200, w: 1200, d: 500, h: 1900 },
      { kind: 'box', label: 'Mortar table', x: 1400, z: 1800, w: 1400, d: 800, h: 900 },
      { kind: 'cylinder', label: 'Scale plinth', x: 2800, z: 1700, w: 600, d: 600, h: 1100 },
      { kind: 'box', label: 'Poison shelf', x: 700, z: 3200, w: 1400, d: 450, h: 2000 },
    ],
    nodes: [
      { title: 'Herb cabinet code', kind: 'puzzle', placement: 'Herb cabinet', answer: '4172' },
      { title: 'Scale balance', kind: 'puzzle', placement: 'Scale plinth' },
      { title: 'Cabinet maglock', kind: 'lock', needs: ['Herb cabinet code'] },
      { title: 'Blacklight label', kind: 'cue', needs: ['Cabinet maglock'] },
      { title: 'Antidote recipe', kind: 'puzzle', needs: ['Blacklight label', 'Scale balance'] },
      { title: 'Exit door', kind: 'exit', needs: ['Antidote recipe'] },
    ],
  },
  {
    name: "Clockmaker's Study", starter: false, size: [3000, 4000, 2600],
    placements: [door('Entry door', 1500), { kind: 'box', label: 'Workbench', x: 1500, z: 2600, w: 1800, d: 800, h: 900 }],
    nodes: [{ title: 'Gear train', kind: 'puzzle' }],
  },
  {
    name: 'Observatory', starter: true, size: [4500, 4500, 3200],
    placements: [
      door('Entry door', 2250, 2200),
      { kind: 'cylinder', label: 'Telescope', x: 2250, z: 2400, w: 900, d: 900, h: 1600 },
      { kind: 'box', label: 'Star chart table', x: 900, z: 3600, w: 1600, d: 900, h: 900 },
    ],
    nodes: [
      { title: 'Star chart', kind: 'puzzle' },
      { title: 'Telescope focus', kind: 'puzzle' },
      { title: 'Dome maglock', kind: 'lock', needs: ['Star chart', 'Telescope focus'] },
      { title: 'Exit door', kind: 'exit', needs: ['Dome maglock'] },
    ],
  },
  {
    name: "Ship's Hold", starter: true, size: [5000, 4000, 2500],
    placements: [
      door('Entry hatch', 2500, 1800),
      { kind: 'box', label: 'Cargo crate', x: 1100, z: 1200, w: 1000, d: 1000, h: 1000 },
      { kind: 'box', label: 'Sea chest', x: 3900, z: 1000, w: 1000, d: 600, h: 700 },
      { kind: 'cylinder', label: 'Mast', x: 2500, z: 2600, w: 400, d: 400, h: 2500 },
      { kind: 'box', label: 'Rope locker', x: 4300, z: 3400, w: 900, d: 700, h: 1500 },
    ],
    nodes: [
      { title: 'Knot board', kind: 'puzzle' },
      { title: 'Crate manifest', kind: 'puzzle', needs: ['Knot board'], answer: 'BOSUN', placement: 'Cargo crate' },
      { title: 'Chest padlock', kind: 'lock', needs: ['Crate manifest'], placement: 'Sea chest' },
      { title: 'Lantern cue', kind: 'cue', needs: ['Chest padlock'] },
      { title: 'Hatch', kind: 'exit', needs: ['Lantern cue'] },
    ],
  },
  {
    name: 'Signal Cabin', starter: true, size: [3500, 2500, 2400],
    placements: [
      door('Entry door', 1750),
      { kind: 'box', label: 'Telegraph desk', x: 900, z: 2000, w: 1400, d: 700, h: 900 },
      { kind: 'box', label: 'Lever frame', x: 2800, z: 1900, w: 900, d: 500, h: 1200 },
    ],
    nodes: [
      { title: 'Morse key', kind: 'puzzle', placement: 'Telegraph desk' },
      { title: 'Lever order', kind: 'puzzle', placement: 'Lever frame' },
      { title: 'Lamp cue', kind: 'cue', needs: ['Morse key', 'Lever order'] },
      { title: 'Cabin door', kind: 'exit', needs: ['Lamp cue'] },
    ],
  },
  {
    name: 'Vault', starter: true, size: [3000, 3000, 2400],
    placements: [
      door('Entry door', 1500),
      { kind: 'box', label: 'Safe', x: 2400, z: 2600, w: 800, d: 700, h: 1000 },
      { kind: 'box', label: 'Desk', x: 800, z: 2400, w: 1500, d: 800, h: 800 },
      { kind: 'cylinder', label: 'Keypad pillar', x: 1500, z: 1500, w: 300, d: 300, h: 1200 },
    ],
    nodes: [
      { title: 'Ledger cipher', kind: 'puzzle', placement: 'Desk' },
      { title: 'Drawer sensor', kind: 'puzzle', needs: ['Ledger cipher'], placement: 'Desk' },
      { title: 'Maglock 3', kind: 'lock', needs: ['Drawer sensor'], placement: 'Safe' },
      { title: 'Blacklight cue', kind: 'cue', needs: ['Maglock 3'] },
      { title: 'Safe dial', kind: 'puzzle', needs: ['Blacklight cue'], answer: '0815', placement: 'Safe' },
      { title: 'Vault door', kind: 'exit', needs: ['Safe dial'], placement: 'Keypad pillar' },
    ],
  },
];

export const CLOCKTOWER_DRAFT: StarterRoom = {
  name: 'Clocktower Draft', starter: false, size: [3000, 3000, 2400],
  placements: [door('Entry door', 1500)],
  nodes: [{ title: 'Pendulum', kind: 'puzzle' }],
};

/** The Vault as the public tour shows it: built in, belonging to no workspace. */
export const TOUR_VAULT: StarterRoom = STARTER_ROOMS.find((room) => room.name === 'Vault')!;
