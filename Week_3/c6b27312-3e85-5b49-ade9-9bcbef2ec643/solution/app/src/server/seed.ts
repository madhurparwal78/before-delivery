// The seed data of the brief: three people, twelve listed parts, the hidden hero part and their likes.
import { db, withAdvisoryLock } from "./db";
import { insertUser } from "./auth";
import { applyLike } from "./parts";
import { SEED_LOCK } from "./schema";
import { commitRevision, createPart, prepareRevision } from "./revisions";
import { headRevision, sourceText } from "./records";
import type { Values } from "../shared/tine";

const PASSWORD = "bench-seed-2026";

const USERS = {
  ines: { email: "ines@gimbrel.test", displayName: "Ines Calloway" },
  tomasz: { email: "tomasz@gimbrel.test", displayName: "Tomasz Rehn" },
  priya: { email: "priya@gimbrel.test", displayName: "Priya Okafor" },
};

type Owner = keyof typeof USERS;

interface SeedPart {
  slug: string;
  title: string;
  category: string;
  owner: Owner;
  created: string;
  source: string;
  /** Position in the Featured order; the hidden hero part has none and is never listed. */
  position?: number;
}

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

const PARTS: SeedPart[] = [
  {
    slug: "twin-hole-plate", title: "Twin-hole plate", category: "hardware", owner: "ines", created: "2026-09-02", position: 1,
    source: lines(
      "# twin-hole-plate",
      "param width = 60 mm min 20 max 200",
      "param depth = 40 mm min 20 max 200",
      "param thickness = 8 mm min 2 max 30",
      "param holeDia = 5 mm min 2 max 20",
      "param holeSpacing = 40 mm min 0 max 180",
      "box width depth thickness",
      "hole holeDia at -holeSpacing/2 0",
      "hole holeDia at holeSpacing/2 0",
    ),
  },
  {
    slug: "peg-rail", title: "Peg rail", category: "organisers", owner: "tomasz", created: "2026-09-05", position: 2,
    source: lines(
      "# peg-rail",
      "param length = 120 mm min 40 max 400",
      "param depth = 18 mm min 10 max 40",
      "param thickness = 6 mm min 3 max 20",
      "param pegCount = 3 count min 0 max 12",
      "param pegPitch = 30 mm min 12 max 80",
      "param pegDia = 6 mm min 3 max 12",
      "param pegHeight = 20 mm min 0 max 60",
      "box length depth thickness",
      "repeat pegCount pegPitch {",
      "boss pegDia pegHeight at -(pegCount-1)*pegPitch/2 0",
      "}",
    ),
  },
  {
    slug: "shelf-bracket", title: "Shelf bracket plate", category: "brackets", owner: "priya", created: "2026-09-09", position: 3,
    source: lines(
      "# shelf-bracket",
      "param width = 50 mm min 30 max 120",
      "param height = 120 mm min 60 max 300",
      "param thickness = 5 mm min 3 max 12",
      "param screwDia = 4.5 mm min 3 max 8",
      "param slotTravel = 10 mm min 0 max 30",
      "box width height thickness",
      "slot screwDia slotTravel at 0 -height/2+15",
      "slot screwDia slotTravel at 0 height/2-15",
    ),
  },
  {
    slug: "cable-comb", title: "Cable comb", category: "organisers", owner: "ines", created: "2026-09-14", position: 4,
    source: lines(
      "# cable-comb",
      "param length = 90 mm",
      "param depth = 24 mm min 12 max 60",
      "param thickness = 4 mm min 2 max 10",
      "param slotCount = 5 count min 1 max 12",
      "param slotWidth = 6 mm min 2 max 14",
      "param slotPitch = 15 mm min 6 max 40",
      "box length depth thickness",
      "repeat slotCount slotPitch {",
      "slot slotWidth 0 at -(slotCount-1)*slotPitch/2 0",
      "}",
    ),
  },
  {
    slug: "hinge-leaf", title: "Hinge leaf", category: "hardware", owner: "tomasz", created: "2026-09-18", position: 5,
    source: lines(
      "# hinge-leaf",
      "param leafWidth = 40 mm min 20 max 100",
      "param leafHeight = 60 mm min 30 max 150",
      "param thickness = 3 mm min 1.5 max 8",
      "param screwSize = M4 options M3, M4, M5, M6",
      "let screwDia = pick(screwSize,M3:3.4,M4:4.5,M5:5.5,M6:6.6)",
      "param knuckle = true",
      "box leafWidth leafHeight thickness",
      "hole screwDia at 0 -leafHeight/4",
      "hole screwDia at 0 leafHeight/4",
      "boss 8 leafHeight/2 at -leafWidth/2+5 0 if knuckle",
    ),
  },
  {
    slug: "spacer-ring", title: "Spacer ring", category: "hardware", owner: "priya", created: "2026-09-23", position: 6,
    source: lines(
      "# spacer-ring",
      "param outerDia = 20 mm min 6 max 120",
      "param boreDia = 8.4 mm min 2 max 100",
      "param height = 10 mm min 0.5 max 80",
      "cylinder outerDia height",
      "hole boreDia at 0 0",
    ),
  },
  {
    slug: "label-holder", title: "Drawer label holder", category: "organisers", owner: "ines", created: "2026-09-27", position: 7,
    source: lines(
      "# label-holder",
      "param labelSize = M options S, M, L",
      "let labelWidth = pick(labelSize,S:40,M:60,L:80)",
      "param depth = 22 mm min 12 max 40",
      "param thickness = 2.5 mm min 1.5 max 6",
      "param screwDia = 3 mm min 2 max 5",
      "box labelWidth+16 depth thickness",
      "hole screwDia at -labelWidth/2-4 0",
      "hole screwDia at labelWidth/2+4 0",
    ),
  },
  {
    slug: "pipe-saddle", title: "Pipe saddle", category: "plumbing", owner: "tomasz", created: "2026-10-01", position: 8,
    source: lines(
      "# pipe-saddle",
      "param pipeDia = 22 mm min 10 max 60",
      "param baseLength = 70 mm min 40 max 160",
      "param baseWidth = 20 mm min 12 max 50",
      "param thickness = 4 mm min 2 max 10",
      "param screwDia = 4 mm min 3 max 6",
      "box baseLength baseWidth thickness",
      "hole screwDia at -baseLength/2+8 0",
      "hole screwDia at baseLength/2-8 0",
      "slot pipeDia/4 pipeDia at 0 0",
    ),
  },
  {
    slug: "fan-grille-plate", title: "Fan grille plate", category: "enclosure-parts", owner: "priya", created: "2026-10-06", position: 9,
    source: lines(
      "# fan-grille-plate",
      "param fanSize = 40 mm min 25 max 140",
      "param thickness = 2 mm min 1.2 max 5",
      "param ventCount = 4 count min 1 max 10",
      "param ventDia = 5 mm min 2 max 12",
      "param ventPitch = 7 mm min 3 max 20",
      "param mountHole = 3.4 mm min 2.5 max 4.5",
      "box fanSize fanSize thickness",
      "repeat ventCount ventPitch {",
      "hole ventDia at -(ventCount-1)*ventPitch/2 0",
      "}",
      "hole mountHole at -fanSize/2+4 -fanSize/2+4",
      "hole mountHole at fanSize/2-4 -fanSize/2+4",
      "hole mountHole at -fanSize/2+4 fanSize/2-4",
      "hole mountHole at fanSize/2-4 fanSize/2-4",
    ),
  },
  {
    slug: "hose-clip", title: "Hose clip", category: "plumbing", owner: "ines", created: "2026-10-10", position: 10,
    source: lines(
      "# hose-clip",
      "param hoseDia = 16 mm min 6 max 40",
      "param width = 12 mm min 6 max 30",
      "param thickness = 3 mm min 2 max 8",
      "param screwDia = 4.5 mm min 3 max 6",
      "box hoseDia+24 hoseDia+8 thickness",
      "hole hoseDia at 0 0",
      "hole screwDia at -hoseDia/2-6 0",
      "hole screwDia at hoseDia/2+6 0",
    ),
  },
  {
    slug: "jig-fence-block", title: "Jig fence block", category: "jigs", owner: "tomasz", created: "2026-10-15", position: 11,
    source: lines(
      "# jig-fence-block",
      "param length = 80 mm min 40 max 200",
      "param width = 30 mm min 16 max 80",
      "param height = 40 mm min 10 max 80",
      "param pinDia = 5 mm min 3 max 12",
      "param pinEdge = 1.2 mm min 0.5 max 20",
      "param clampSlot = 6 mm min 4 max 12",
      "box length width height",
      "hole pinDia at -length/2+pinEdge+pinDia/2 0",
      "hole pinDia at length/2-pinEdge-pinDia/2 0",
      "slot clampSlot 30 at 0 0",
    ),
  },
  {
    slug: "pegboard-hook-plate", title: "Pegboard hook plate", category: "hardware", owner: "priya", created: "2026-10-20", position: 12,
    source: lines(
      "# pegboard-hook-plate",
      "param plateWidth = 50 mm min 30 max 120",
      "param plateHeight = 40 mm min 25 max 100",
      "param thickness = 4 mm min 2 max 10",
      "param pegHoleDia = 6.4 mm min 4 max 8",
      "param hookCount = 2 count min 1 max 6",
      "param hookPitch = 25.4 mm min 12 max 50",
      "param hookDia = 6 mm min 3 max 10",
      "param hookLength = 30 mm min 0 max 80",
      "box plateWidth plateHeight thickness",
      "hole pegHoleDia at -12.7 plateHeight/2-8",
      "hole pegHoleDia at 12.7 plateHeight/2-8",
      "repeat hookCount hookPitch {",
      "boss hookDia hookLength at -(hookCount-1)*hookPitch/2 -plateHeight/4",
      "}",
    ),
  },
  {
    slug: "hero-cable-clip", title: "Hero cable clip", category: "hardware", owner: "ines", created: "2026-08-30",
    source: lines(
      "# hero-cable-clip",
      "param span = 84.67 mm min 40 max 400 step 0.01",
      "param depth = 14 mm",
      "param thickness = 3 mm",
      "box span depth thickness",
      "hole 4 at -span/2+6 0",
      "hole 4 at span/2-6 0",
      "slot 5 span-30 at 0 0",
    ),
  },
];

/** Later revisions of seeded parts, in order, with the day they were made. */
const EXTRA_REVISIONS: { slug: string; values: Values; message: string; created: string }[] = [
  { slug: "peg-rail", values: { pegCount: 1, pegPitch: 30 }, message: "Single peg", created: "2026-09-06" },
  { slug: "peg-rail", values: { pegCount: 1, pegPitch: 45 }, message: "Single peg, wider pitch", created: "2026-09-07" },
];

const LIKES: { slug: string; by: Owner[]; created: string }[] = [
  { slug: "twin-hole-plate", by: ["tomasz", "priya"], created: "2026-09-10" },
  { slug: "peg-rail", by: ["ines"], created: "2026-09-11" },
  { slug: "jig-fence-block", by: ["ines", "priya"], created: "2026-10-16" },
];

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function seedPeople(): Promise<Map<Owner, string>> {
  const ids = new Map<Owner, string>();
  for (const [key, person] of Object.entries(USERS) as [Owner, (typeof USERS)[Owner]][]) {
    const known = await db.row<{ id: string }>("SELECT id FROM users WHERE email_fold = $1", [person.email]);
    ids.set(key, known?.id ?? (await insertUser(db, { ...person, password: PASSWORD, verified: true, createdAt: day("2026-08-01") })));
  }
  return ids;
}

/** Whether every seeded part, its extra revisions and its likes are already stored. */
async function complete(): Promise<boolean> {
  const stored = await db.one<{ parts: number; revisions: number }>(
    "SELECT (SELECT count(*)::int FROM parts WHERE slug = ANY($1)) AS parts, (SELECT count(*)::int FROM revisions WHERE part_slug = ANY($2)) AS revisions",
    [PARTS.map((p) => p.slug), [...new Set(EXTRA_REVISIONS.map((r) => r.slug))]],
  );
  return stored.parts === PARTS.length && stored.revisions >= EXTRA_REVISIONS.length + 1;
}

/**
 * Writes whatever seed data is missing. Needs storage, since a revision is stored before its row is written;
 * a copy that cannot reach storage leaves this to one that can.
 */
export async function seed(): Promise<void> {
  if (await complete()) return;
  await withAdvisoryLock(SEED_LOCK, async () => {
    const people = await seedPeople();
    for (const part of PARTS) {
      if (await db.row("SELECT 1 FROM parts WHERE slug = $1", [part.slug])) continue;
      await createPart({
        slug: part.slug, title: part.title, category: part.category, visibility: "public", ownerId: people.get(part.owner) as string,
        sourceText: part.source, values: {}, message: "First version", createdAt: day(part.created), seedPosition: part.position, listed: part.position !== undefined,
      });
    }
    for (const extra of EXTRA_REVISIONS) {
      const head = await headRevision(db, extra.slug);
      const rank = EXTRA_REVISIONS.filter((r) => r.slug === extra.slug).indexOf(extra) + 2;
      if (head.n >= rank) continue;
      const source = await sourceText(db, head.source_ref);
      const author = people.get("tomasz") as string;
      const prepared = await prepareRevision({ partSlug: extra.slug, sourceText: source, values: extra.values, authorId: author });
      await commitRevision({ ...prepared, partSlug: extra.slug, authorId: author, values: extra.values, message: extra.message, createdAt: day(extra.created) }, null);
    }
    for (const like of LIKES) {
      for (const who of like.by) await applyLike(like.slug, people.get(who) as string, true, day(like.created));
    }
  });
}
