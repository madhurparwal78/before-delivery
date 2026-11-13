/** The seeded people, parts and likes. Every seeded person, part and business is invented. */

export type SeedUser = { displayName: string; email: string };

export const SEED_PASSWORD = 'bench-seed-2026';

export const SEED_USERS: SeedUser[] = [
  { displayName: 'Ines Calloway', email: 'ines@gimbrel.test' },
  { displayName: 'Tomasz Rehn', email: 'tomasz@gimbrel.test' },
  { displayName: 'Priya Okafor', email: 'priya@gimbrel.test' },
];

export type SeedPart = {
  position: number;
  slug: string;
  title: string;
  category: string;
  ownerEmail: string;
  createdAt: string;
  source: string;
};

const TWIN_HOLE_PLATE = `# twin-hole-plate
param width = 60 mm min 20 max 200
param depth = 40 mm min 20 max 200
param thickness = 8 mm min 2 max 30
param holeDia = 5 mm min 2 max 20
param holeSpacing = 40 mm min 0 max 180
box width depth thickness
hole holeDia at -holeSpacing/2 0
hole holeDia at holeSpacing/2 0
`;

const PEG_RAIL = `# peg-rail
param length = 120 mm min 40 max 400
param depth = 18 mm min 10 max 40
param thickness = 6 mm min 3 max 20
param pegCount = 3 count min 0 max 12
param pegPitch = 30 mm min 12 max 80
param pegDia = 6 mm min 3 max 12
param pegHeight = 20 mm min 0 max 60
box length depth thickness
repeat pegCount pegPitch {
boss pegDia pegHeight at -(pegCount-1)*pegPitch/2 0
}
`;

const SHELF_BRACKET = `# shelf-bracket
param width = 50 mm min 30 max 120
param height = 120 mm min 60 max 300
param thickness = 5 mm min 3 max 12
param screwDia = 4.5 mm min 3 max 8
param slotTravel = 10 mm min 0 max 30
box width height thickness
slot screwDia slotTravel at 0 -height/2+15
slot screwDia slotTravel at 0 height/2-15
`;

const CABLE_COMB = `# cable-comb
param length = 90 mm
param depth = 24 mm min 12 max 60
param thickness = 4 mm min 2 max 10
param slotCount = 5 count min 1 max 12
param slotWidth = 6 mm min 2 max 14
param slotPitch = 15 mm min 6 max 40
box length depth thickness
repeat slotCount slotPitch {
slot slotWidth 0 at -(slotCount-1)*slotPitch/2 0
}
`;

const HINGE_LEAF = `# hinge-leaf
param leafWidth = 40 mm min 20 max 100
param leafHeight = 60 mm min 30 max 150
param thickness = 3 mm min 1.5 max 8
param screwSize = M4 options M3, M4, M5, M6
let screwDia = pick(screwSize,M3:3.4,M4:4.5,M5:5.5,M6:6.6)
param knuckle = true
box leafWidth leafHeight thickness
hole screwDia at 0 -leafHeight/4
hole screwDia at 0 leafHeight/4
boss 8 leafHeight/2 at -leafWidth/2+5 0 if knuckle
`;

const SPACER_RING = `# spacer-ring
param outerDia = 20 mm min 6 max 120
param boreDia = 8.4 mm min 2 max 100
param height = 10 mm min 0.5 max 80
cylinder outerDia height
hole boreDia at 0 0
`;

const LABEL_HOLDER = `# label-holder
param labelSize = M options S, M, L
let labelWidth = pick(labelSize,S:40,M:60,L:80)
param depth = 22 mm min 12 max 40
param thickness = 2.5 mm min 1.5 max 6
param screwDia = 3 mm min 2 max 5
box labelWidth+16 depth thickness
hole screwDia at -labelWidth/2-4 0
hole screwDia at labelWidth/2+4 0
`;

const PIPE_SADDLE = `# pipe-saddle
param pipeDia = 22 mm min 10 max 60
param baseLength = 70 mm min 40 max 160
param baseWidth = 20 mm min 12 max 50
param thickness = 4 mm min 2 max 10
param screwDia = 4 mm min 3 max 6
box baseLength baseWidth thickness
hole screwDia at -baseLength/2+8 0
hole screwDia at baseLength/2-8 0
slot pipeDia/4 pipeDia at 0 0
`;

const FAN_GRILLE_PLATE = `# fan-grille-plate
param fanSize = 40 mm min 25 max 140
param thickness = 2 mm min 1.2 max 5
param ventCount = 4 count min 1 max 10
param ventDia = 5 mm min 2 max 12
param ventPitch = 7 mm min 3 max 20
param mountHole = 3.4 mm min 2.5 max 4.5
box fanSize fanSize thickness
repeat ventCount ventPitch {
hole ventDia at -(ventCount-1)*ventPitch/2 0
}
hole mountHole at -fanSize/2+4 -fanSize/2+4
hole mountHole at fanSize/2-4 -fanSize/2+4
hole mountHole at -fanSize/2+4 fanSize/2-4
hole mountHole at fanSize/2-4 fanSize/2-4
`;

const HOSE_CLIP = `# hose-clip
param hoseDia = 16 mm min 6 max 40
param width = 12 mm min 6 max 30
param thickness = 3 mm min 2 max 8
param screwDia = 4.5 mm min 3 max 6
box hoseDia+24 hoseDia+8 thickness
hole hoseDia at 0 0
hole screwDia at -hoseDia/2-6 0
hole screwDia at hoseDia/2+6 0
`;

const JIG_FENCE_BLOCK = `# jig-fence-block
param length = 80 mm min 40 max 200
param width = 30 mm min 16 max 80
param height = 40 mm min 10 max 80
param pinDia = 5 mm min 3 max 12
param pinEdge = 1.2 mm min 0.5 max 20
param clampSlot = 6 mm min 4 max 12
box length width height
hole pinDia at -length/2+pinEdge+pinDia/2 0
hole pinDia at length/2-pinEdge-pinDia/2 0
slot clampSlot 30 at 0 0
`;

const PEGBOARD_HOOK_PLATE = `# pegboard-hook-plate
param plateWidth = 50 mm min 30 max 120
param plateHeight = 40 mm min 25 max 100
param thickness = 4 mm min 2 max 10
param pegHoleDia = 6.4 mm min 4 max 8
param hookCount = 2 count min 1 max 6
param hookPitch = 25.4 mm min 12 max 50
param hookDia = 6 mm min 3 max 10
param hookLength = 30 mm min 0 max 80
box plateWidth plateHeight thickness
hole pegHoleDia at -12.7 plateHeight/2-8
hole pegHoleDia at 12.7 plateHeight/2-8
repeat hookCount hookPitch {
boss hookDia hookLength at -(hookCount-1)*hookPitch/2 -plateHeight/4
}
`;

export const HERO_SLUG = 'hero-cable-clip';

export const HERO_SOURCE = `# hero-cable-clip
param span = 84.67 mm min 40 max 400 step 0.01
param depth = 14 mm
param thickness = 3 mm
box span depth thickness
hole 4 at -span/2+6 0
hole 4 at span/2-6 0
slot 5 span-30 at 0 0
`;

export const SEED_PARTS: SeedPart[] = [
  {
    position: 1,
    slug: 'twin-hole-plate',
    title: 'Twin-hole plate',
    category: 'hardware',
    ownerEmail: 'ines@gimbrel.test',
    createdAt: '2026-09-02T00:00:00.000Z',
    source: TWIN_HOLE_PLATE,
  },
  {
    position: 2,
    slug: 'peg-rail',
    title: 'Peg rail',
    category: 'organisers',
    ownerEmail: 'tomasz@gimbrel.test',
    createdAt: '2026-09-05T00:00:00.000Z',
    source: PEG_RAIL,
  },
  {
    position: 3,
    slug: 'shelf-bracket',
    title: 'Shelf bracket plate',
    category: 'brackets',
    ownerEmail: 'priya@gimbrel.test',
    createdAt: '2026-09-09T00:00:00.000Z',
    source: SHELF_BRACKET,
  },
  {
    position: 4,
    slug: 'cable-comb',
    title: 'Cable comb',
    category: 'organisers',
    ownerEmail: 'ines@gimbrel.test',
    createdAt: '2026-09-14T00:00:00.000Z',
    source: CABLE_COMB,
  },
  {
    position: 5,
    slug: 'hinge-leaf',
    title: 'Hinge leaf',
    category: 'hardware',
    ownerEmail: 'tomasz@gimbrel.test',
    createdAt: '2026-09-18T00:00:00.000Z',
    source: HINGE_LEAF,
  },
  {
    position: 6,
    slug: 'spacer-ring',
    title: 'Spacer ring',
    category: 'hardware',
    ownerEmail: 'priya@gimbrel.test',
    createdAt: '2026-09-23T00:00:00.000Z',
    source: SPACER_RING,
  },
  {
    position: 7,
    slug: 'label-holder',
    title: 'Drawer label holder',
    category: 'organisers',
    ownerEmail: 'ines@gimbrel.test',
    createdAt: '2026-09-27T00:00:00.000Z',
    source: LABEL_HOLDER,
  },
  {
    position: 8,
    slug: 'pipe-saddle',
    title: 'Pipe saddle',
    category: 'plumbing',
    ownerEmail: 'tomasz@gimbrel.test',
    createdAt: '2026-10-01T00:00:00.000Z',
    source: PIPE_SADDLE,
  },
  {
    position: 9,
    slug: 'fan-grille-plate',
    title: 'Fan grille plate',
    category: 'enclosure-parts',
    ownerEmail: 'priya@gimbrel.test',
    createdAt: '2026-10-06T00:00:00.000Z',
    source: FAN_GRILLE_PLATE,
  },
  {
    position: 10,
    slug: 'hose-clip',
    title: 'Hose clip',
    category: 'plumbing',
    ownerEmail: 'ines@gimbrel.test',
    createdAt: '2026-10-10T00:00:00.000Z',
    source: HOSE_CLIP,
  },
  {
    position: 11,
    slug: 'jig-fence-block',
    title: 'Jig fence block',
    category: 'jigs',
    ownerEmail: 'tomasz@gimbrel.test',
    createdAt: '2026-10-15T00:00:00.000Z',
    source: JIG_FENCE_BLOCK,
  },
  {
    position: 12,
    slug: 'pegboard-hook-plate',
    title: 'Pegboard hook plate',
    category: 'hardware',
    ownerEmail: 'priya@gimbrel.test',
    createdAt: '2026-10-20T00:00:00.000Z',
    source: PEGBOARD_HOOK_PLATE,
  },
];

export const SEED_EXTRA_REVISIONS = [
  {
    slug: 'peg-rail',
    values: { pegCount: 1, pegPitch: 30 },
    message: 'Single peg',
    authorEmail: 'tomasz@gimbrel.test',
  },
  {
    slug: 'peg-rail',
    values: { pegCount: 1, pegPitch: 45 },
    message: 'Single peg, wider pitch',
    authorEmail: 'tomasz@gimbrel.test',
  },
];

export const SEED_LIKES: { slug: string; emails: string[] }[] = [
  { slug: 'twin-hole-plate', emails: ['tomasz@gimbrel.test', 'priya@gimbrel.test'] },
  { slug: 'peg-rail', emails: ['ines@gimbrel.test'] },
  { slug: 'jig-fence-block', emails: ['ines@gimbrel.test', 'priya@gimbrel.test'] },
];

export const CATEGORIES: { slug: string; name: string }[] = [
  { slug: 'hardware', name: 'Hardware' },
  { slug: 'organisers', name: 'Organisers' },
  { slug: 'brackets', name: 'Brackets' },
  { slug: 'plumbing', name: 'Plumbing' },
  { slug: 'enclosure-parts', name: 'Enclosure parts' },
  { slug: 'jigs', name: 'Jigs' },
];
