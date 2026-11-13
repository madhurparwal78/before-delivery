import type { NodeKind, PlacementKind } from '../shared/types.js';

interface SeedPlacement {
  id: string;
  kind: PlacementKind;
  label: string;
  x: number; y: number; z: number;
  w: number; d: number; h: number;
  rotation?: number;
}

interface SeedNode {
  id: string;
  title: string;
  kind: NodeKind;
  placementId: string | null;
  answer: string | null;
  needs: string[];
}

export interface SeedRoom {
  name: string;
  starter: boolean;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  placements: SeedPlacement[];
  nodes: SeedNode[];
}

const room = (
  name: string,
  starter: boolean,
  w: number,
  d: number,
  h: number,
  placements: SeedPlacement[],
  nodes: SeedNode[]
): SeedRoom => ({ name, starter, widthMm: w, depthMm: d, heightMm: h, placements, nodes });

const door = (id: string, label: string, x: number, w = 900): SeedPlacement =>
  ({ id, kind: 'door', label, x, y: 0, z: 0, w, d: 80, h: 2000 });

const box = (id: string, label: string, x: number, z: number, w: number, d: number, h: number): SeedPlacement =>
  ({ id, kind: 'box', label, x, y: 0, z, w, d, h });

const cylinder = (id: string, label: string, x: number, z: number, r: number, h: number): SeedPlacement =>
  ({ id, kind: 'cylinder', label, x, y: 0, z, w: r * 2, d: r * 2, h });

const node = (id: string, title: string, kind: NodeKind, placementId: string | null, answer: string | null, needs: string[]): SeedNode =>
  ({ id, title, kind, placementId, answer, needs });

export function starterRooms(): SeedRoom[] {
  return [
    room('Apothecary', true, 4000, 3500, 2700,
      [
        door('p1', 'Entry door', 1550),
        box('p2', 'Herb cabinet', 200, 400, 800, 500, 1800),
        box('p3', 'Mortar table', 2400, 2800, 1500, 800, 750),
        cylinder('p4', 'Scale plinth', 3400, 1000, 300, 900),
        box('p5', 'Poison shelf', 3000, 200, 900, 400, 1600),
      ],
      [
        node('n1', 'Herb cabinet code', 'puzzle', 'p2', '4172', []),
        node('n2', 'Scale balance', 'puzzle', 'p4', null, []),
        node('n3', 'Cabinet maglock', 'lock', 'p2', null, ['n1']),
        node('n4', 'Blacklight label', 'cue', null, null, ['n3']),
        node('n5', 'Antidote recipe', 'puzzle', null, null, ['n4', 'n2']),
        node('n6', 'Exit door', 'exit', 'p1', null, ['n5']),
      ]),
    room("Clockmaker's Study", false, 3000, 4000, 2600,
      [
        door('p1', 'Entry door', 1050),
        box('p2', 'Workbench', 800, 2800, 1800, 800, 850),
      ],
      [
        node('n1', 'Gear train', 'puzzle', 'p2', null, []),
      ]),
    room('Observatory', true, 4500, 4500, 3200,
      [
        door('p1', 'Entry door', 1800),
        cylinder('p2', 'Telescope', 3300, 3200, 350, 1400),
        box('p3', 'Star chart table', 900, 1000, 1500, 900, 800),
      ],
      [
        node('n1', 'Star chart', 'puzzle', 'p3', null, []),
        node('n2', 'Telescope focus', 'puzzle', 'p2', null, []),
        node('n3', 'Dome maglock', 'lock', null, null, ['n1', 'n2']),
        node('n4', 'Exit door', 'exit', 'p1', null, ['n3']),
      ]),
    room("Ship's Hold", true, 5000, 4000, 2500,
      [
        ({ id: 'p1', kind: 'door', label: 'Entry hatch', x: 2050, y: 0, z: 0, w: 900, d: 80, h: 2000 }) as SeedPlacement,
        box('p2', 'Cargo crate', 300, 300, 1000, 1000, 1000),
        box('p3', 'Sea chest', 3200, 500, 900, 550, 500),
        cylinder('p4', 'Mast', 2400, 2000, 200, 2500),
        box('p5', 'Rope locker', 4200, 3200, 700, 400, 600),
      ],
      [
        node('n1', 'Knot board', 'puzzle', null, null, []),
        node('n2', 'Crate manifest', 'puzzle', 'p2', 'BOSUN', ['n1']),
        node('n3', 'Chest padlock', 'lock', 'p3', null, ['n2']),
        node('n4', 'Lantern cue', 'cue', null, null, ['n3']),
        node('n5', 'Hatch', 'exit', 'p1', null, ['n4']),
      ]),
    room('Signal Cabin', true, 3500, 2500, 2400,
      [
        door('p1', 'Entry door', 1300),
        box('p2', 'Telegraph desk', 500, 1700, 1400, 700, 900),
        box('p3', 'Lever frame', 2300, 1700, 900, 400, 1100),
      ],
      [
        node('n1', 'Morse key', 'puzzle', 'p2', null, []),
        node('n2', 'Lever order', 'puzzle', 'p3', null, []),
        node('n3', 'Lamp cue', 'cue', null, null, ['n1', 'n2']),
        node('n4', 'Cabin door', 'exit', 'p1', null, ['n3']),
      ]),
    room('Vault', true, 3000, 3000, 2400,
      [
        door('p1', 'Entry door', 1050),
        box('p2', 'Safe', 200, 2000, 700, 600, 900),
        box('p3', 'Desk', 1900, 2400, 1400, 700, 750),
        cylinder('p4', 'Keypad pillar', 1500, 1200, 200, 2200),
      ],
      [
        node('n1', 'Ledger cipher', 'puzzle', 'p3', null, []),
        node('n2', 'Drawer sensor', 'puzzle', 'p3', null, ['n1']),
        node('n3', 'Maglock 3', 'lock', null, null, ['n2']),
        node('n4', 'Blacklight cue', 'cue', null, null, ['n3']),
        node('n5', 'Safe dial', 'puzzle', 'p2', '0815', ['n4']),
        node('n6', 'Vault door', 'exit', 'p1', null, ['n5']),
      ]),
  ];
}

export const seedUsers = [
  { email: 'mara@lanternlane.test', password: 'keyway-owner-1', displayName: 'Mara Quint', venue: 'Lantern Lane Escapes', role: 'owner' },
  { email: 'tobi@lanternlane.test', password: 'keyway-codesign-1', displayName: 'Tobi Ferreira', venue: 'Lantern Lane Escapes', role: 'co_designer' },
  { email: 'ines@brasskey.test', password: 'keyway-other-1', displayName: 'Ines Albright', venue: 'Brass Key Rooms', role: 'owner' },
];
