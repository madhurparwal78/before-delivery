export const SEED_USERS = [
  { key: "ines", email: "ines@gimbrel.test", password: "bench-seed-2026", displayName: "Ines Calloway" },
  { key: "tomasz", email: "tomasz@gimbrel.test", password: "bench-seed-2026", displayName: "Tomasz Rehn" },
  { key: "priya", email: "priya@gimbrel.test", password: "bench-seed-2026", displayName: "Priya Okafor" },
] as const;

export interface SeedPart {
  slug: string;
  title: string;
  category: string;
  ownerKey: string;
  seedPosition: number;
  createdAt: string;
  source: string;
}

const s = (slug: string, title: string, category: string, ownerKey: string, seedPosition: number, createdAt: string, source: string): SeedPart =>
  ({ slug, title, category, ownerKey, seedPosition, createdAt, source });

export const SEED_PARTS: SeedPart[] = [
  s("twin-hole-plate", "Twin-hole plate", "hardware", "ines", 1, "2026-09-02T10:00:00Z", `# twin-hole-plate
param width = 60 mm min 20 max 200
param depth = 40 mm min 20 max 200
param thickness = 8 mm min 2 max 30
param holeDia = 5 mm min 2 max 20
param holeSpacing = 40 mm min 0 max 180
box width depth thickness
hole holeDia at -holeSpacing/2 0
hole holeDia at holeSpacing/2 0`),
  s("peg-rail", "Peg rail", "organisers", "tomasz", 2, "2026-09-05T10:00:00Z", `# peg-rail
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
}`),
  s("shelf-bracket", "Shelf bracket plate", "brackets", "priya", 3, "2026-09-09T10:00:00Z", `# shelf-bracket
param width = 50 mm min 30 max 120
param height = 120 mm min 60 max 300
param thickness = 5 mm min 3 max 12
param screwDia = 4.5 mm min 3 max 8
param slotTravel = 10 mm min 0 max 30
box width height thickness
slot screwDia slotTravel at 0 -height/2+15
slot screwDia slotTravel at 0 height/2-15`),
  s("cable-comb", "Cable comb", "organisers", "ines", 4, "2026-09-14T10:00:00Z", `# cable-comb
param length = 90 mm
param depth = 24 mm min 12 max 60
param thickness = 4 mm min 2 max 10
param slotCount = 5 count min 1 max 12
param slotWidth = 6 mm min 2 max 14
param slotPitch = 15 mm min 6 max 40
box length depth thickness
repeat slotCount slotPitch {
slot slotWidth 0 at -(slotCount-1)*slotPitch/2 0
}`),
  s("hinge-leaf", "Hinge leaf", "hardware", "tomasz", 5, "2026-09-18T10:00:00Z", `# hinge-leaf
param leafWidth = 40 mm min 20 max 100
param leafHeight = 60 mm min 30 max 150
param thickness = 3 mm min 1.5 max 8
param screwSize = M4 options M3, M4, M5, M6
let screwDia = pick(screwSize,M3:3.4,M4:4.5,M5:5.5,M6:6.6)
param knuckle = true
box leafWidth leafHeight thickness
hole screwDia at 0 -leafHeight/4
hole screwDia at 0 leafHeight/4
boss 8 leafHeight/2 at -leafWidth/2+5 0 if knuckle`),
  s("spacer-ring", "Spacer ring", "hardware", "priya", 6, "2026-09-23T10:00:00Z", `# spacer-ring
param outerDia = 20 mm min 6 max 120
param boreDia = 8.4 mm min 2 max 100
param height = 10 mm min 0.5 max 80
cylinder outerDia height
hole boreDia at 0 0`),
  s("label-holder", "Drawer label holder", "organisers", "ines", 7, "2026-09-27T10:00:00Z", `# label-holder
param labelSize = M options S, M, L
let labelWidth = pick(labelSize,S:40,M:60,L:80)
param depth = 22 mm min 12 max 40
param thickness = 2.5 mm min 1.5 max 6
param screwDia = 3 mm min 2 max 5
box labelWidth+16 depth thickness
hole screwDia at -labelWidth/2-4 0
hole screwDia at labelWidth/2+4 0`),
  s("pipe-saddle", "Pipe saddle", "plumbing", "tomasz", 8, "2026-10-01T10:00:00Z", `# pipe-saddle
param pipeDia = 22 mm min 10 max 60
param baseLength = 70 mm min 40 max 160
param baseWidth = 20 mm min 12 max 50
param thickness = 4 mm min 2 max 10
param screwDia = 4 mm min 3 max 6
box baseLength baseWidth thickness
hole screwDia at -baseLength/2+8 0
hole screwDia at baseLength/2-8 0
slot pipeDia/4 pipeDia at 0 0`),
  s("fan-grille-plate", "Fan grille plate", "enclosure-parts", "priya", 9, "2026-10-06T10:00:00Z", `# fan-grille-plate
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
hole mountHole at fanSize/2-4 fanSize/2-4`),
  s("hose-clip", "Hose clip", "plumbing", "ines", 10, "2026-10-10T10:00:00Z", `# hose-clip
param hoseDia = 16 mm min 6 max 40
param width = 12 mm min 6 max 30
param thickness = 3 mm min 2 max 8
param screwDia = 4.5 mm min 3 max 6
box hoseDia+24 hoseDia+8 thickness
hole hoseDia at 0 0
hole screwDia at -hoseDia/2-6 0
hole screwDia at hoseDia/2+6 0`),
  s("jig-fence-block", "Jig fence block", "jigs", "tomasz", 11, "2026-10-15T10:00:00Z", `# jig-fence-block
param length = 80 mm min 40 max 200
param width = 30 mm min 16 max 80
param height = 40 mm min 10 max 80
param pinDia = 5 mm min 3 max 12
param pinEdge = 1.2 mm min 0.5 max 20
param clampSlot = 6 mm min 4 max 12
box length width height
hole pinDia at -length/2+pinEdge+pinDia/2 0
hole pinDia at length/2-pinEdge-pinDia/2 0
slot clampSlot 30 at 0 0`),
  s("pegboard-hook-plate", "Pegboard hook plate", "hardware", "priya", 12, "2026-10-20T10:00:00Z", `# pegboard-hook-plate
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
}`),
];

/** The hidden hero part: evaluated but never listed. */
export const HERO_SOURCE = `# hero-cable-clip
param span = 84.67 mm min 40 max 400 step 0.01
param depth = 14 mm
param thickness = 3 mm
box span depth thickness
hole 4 at -span/2+6 0
hole 4 at span/2-6 0
slot 5 span-30 at 0 0`;

export const SEED_EXTRA_REVISIONS = [
  { part: "peg-rail", authorKey: "tomasz", values: { pegCount: 1, pegPitch: 30 }, message: "Single peg" },
  { part: "peg-rail", authorKey: "tomasz", values: { pegCount: 1, pegPitch: 45 }, message: "Single peg, wider pitch" },
];

export const SEED_LIKES: { part: string; users: string[] }[] = [
  { part: "twin-hole-plate", users: ["tomasz", "priya"] },
  { part: "peg-rail", users: ["ines"] },
  { part: "jig-fence-block", users: ["ines", "priya"] },
];
