import type { NodeKind, PlacementKind } from './types.js';

export interface StarterPlacement {
  kind: PlacementKind;
  label: string;
  entry?: boolean;
  xMm: number;
  yMm: number;
  zMm: number;
  rotationDeg: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export interface StarterNode {
  title: string;
  kind: NodeKind;
  answer?: string;
  placement?: string;
  needs?: string[];
}

export interface StarterRoom {
  name: string;
  starter: boolean;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  placements: StarterPlacement[];
  nodes: StarterNode[];
}

function door(label: string, xMm: number): StarterPlacement {
  return {
    kind: 'door',
    label,
    entry: true,
    xMm,
    yMm: 0,
    zMm: 0,
    rotationDeg: 0,
    widthMm: 900,
    depthMm: 100,
    heightMm: 2100,
  };
}

function solid(
  kind: 'box' | 'cylinder',
  label: string,
  xMm: number,
  zMm: number,
  widthMm: number,
  depthMm: number,
  heightMm: number,
): StarterPlacement {
  return { kind, label, xMm, yMm: 0, zMm, rotationDeg: 0, widthMm, depthMm, heightMm };
}

export const starterRooms: StarterRoom[] = [
  {
    name: 'Apothecary',
    starter: true,
    widthMm: 4000,
    depthMm: 3500,
    heightMm: 2700,
    placements: [
      door('Entry door', 2000),
      solid('box', 'Herb cabinet', 600, 2800, 1200, 500, 1800),
      solid('box', 'Mortar table', 2000, 1800, 1400, 700, 900),
      solid('cylinder', 'Scale plinth', 3400, 2600, 500, 500, 1100),
      solid('box', 'Poison shelf', 3600, 1200, 400, 1200, 1600),
    ],
    nodes: [
      { title: 'Herb cabinet code', kind: 'puzzle', answer: '4172', placement: 'Herb cabinet' },
      { title: 'Scale balance', kind: 'puzzle', placement: 'Scale plinth' },
      { title: 'Cabinet maglock', kind: 'lock', needs: ['Herb cabinet code'] },
      { title: 'Blacklight label', kind: 'cue', needs: ['Cabinet maglock'] },
      { title: 'Antidote recipe', kind: 'puzzle', needs: ['Blacklight label', 'Scale balance'] },
      { title: 'Exit door', kind: 'exit', needs: ['Antidote recipe'] },
    ],
  },
  {
    name: "Clockmaker's Study",
    starter: false,
    widthMm: 3000,
    depthMm: 4000,
    heightMm: 2600,
    placements: [door('Entry door', 1500), solid('box', 'Workbench', 1500, 2000, 1600, 800, 900)],
    nodes: [{ title: 'Gear train', kind: 'puzzle' }],
  },
  {
    name: 'Observatory',
    starter: true,
    widthMm: 4500,
    depthMm: 4500,
    heightMm: 3200,
    placements: [
      door('Entry door', 2250),
      solid('cylinder', 'Telescope', 2250, 2600, 800, 800, 2200),
      solid('box', 'Star chart table', 900, 1500, 1200, 800, 800),
    ],
    nodes: [
      { title: 'Star chart', kind: 'puzzle', placement: 'Star chart table' },
      { title: 'Telescope focus', kind: 'puzzle', placement: 'Telescope' },
      { title: 'Dome maglock', kind: 'lock', needs: ['Star chart', 'Telescope focus'] },
      { title: 'Exit door', kind: 'exit', needs: ['Dome maglock'] },
    ],
  },
  {
    name: "Ship's Hold",
    starter: true,
    widthMm: 5000,
    depthMm: 4000,
    heightMm: 2500,
    placements: [
      door('Entry hatch', 2500),
      solid('box', 'Cargo crate', 1000, 2600, 1200, 1000, 1000),
      solid('box', 'Sea chest', 3800, 2800, 900, 500, 600),
      solid('cylinder', 'Mast', 2500, 2000, 400, 400, 2500),
      solid('box', 'Rope locker', 4400, 1000, 600, 900, 1200),
    ],
    nodes: [
      { title: 'Knot board', kind: 'puzzle' },
      { title: 'Crate manifest', kind: 'puzzle', answer: 'BOSUN', needs: ['Knot board'], placement: 'Cargo crate' },
      { title: 'Chest padlock', kind: 'lock', needs: ['Crate manifest'], placement: 'Sea chest' },
      { title: 'Lantern cue', kind: 'cue', needs: ['Chest padlock'] },
      { title: 'Hatch', kind: 'exit', needs: ['Lantern cue'] },
    ],
  },
  {
    name: 'Signal Cabin',
    starter: true,
    widthMm: 3500,
    depthMm: 2500,
    heightMm: 2400,
    placements: [
      door('Entry door', 1750),
      solid('box', 'Telegraph desk', 900, 1700, 1400, 700, 800),
      solid('box', 'Lever frame', 2700, 1800, 800, 400, 1200),
    ],
    nodes: [
      { title: 'Morse key', kind: 'puzzle', placement: 'Telegraph desk' },
      { title: 'Lever order', kind: 'puzzle', placement: 'Lever frame' },
      { title: 'Lamp cue', kind: 'cue', needs: ['Morse key', 'Lever order'] },
      { title: 'Cabin door', kind: 'exit', needs: ['Lamp cue'] },
    ],
  },
  {
    name: 'Vault',
    starter: true,
    widthMm: 3000,
    depthMm: 3000,
    heightMm: 2400,
    placements: [
      door('Entry door', 1500),
      solid('box', 'Safe', 600, 2400, 1000, 600, 1600),
      solid('box', 'Desk', 2100, 1500, 1200, 700, 800),
      solid('cylinder', 'Keypad pillar', 2600, 2600, 400, 400, 1300),
    ],
    nodes: [
      { title: 'Ledger cipher', kind: 'puzzle', placement: 'Desk' },
      { title: 'Drawer sensor', kind: 'puzzle', needs: ['Ledger cipher'], placement: 'Desk' },
      { title: 'Maglock 3', kind: 'lock', needs: ['Drawer sensor'], placement: 'Safe' },
      { title: 'Blacklight cue', kind: 'cue', needs: ['Maglock 3'] },
      { title: 'Safe dial', kind: 'puzzle', answer: '0815', needs: ['Blacklight cue'], placement: 'Keypad pillar' },
      { title: 'Vault door', kind: 'exit', needs: ['Safe dial'], placement: 'Entry door' },
    ],
  },
];

export const clocktowerDraft: StarterRoom = {
  name: 'Clocktower Draft',
  starter: false,
  widthMm: 3000,
  depthMm: 3000,
  heightMm: 2400,
  placements: [door('Entry door', 1500)],
  nodes: [{ title: 'Pendulum', kind: 'puzzle' }],
};

/** The built-in Vault copy the public tour walks through. It belongs to no workspace. */
export const tourRoom: StarterRoom = starterRooms[starterRooms.length - 1];
