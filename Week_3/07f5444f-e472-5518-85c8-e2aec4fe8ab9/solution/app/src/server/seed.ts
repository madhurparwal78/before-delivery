// Applies the schema on every start and writes the seed records into an empty database.
// Both run under one advisory lock, so several copies of the app can start against one database.

import type pg from "pg";
import { addDays, londonDate, wallClockToInstant } from "../shared/london.js";
import { SCHEMA } from "./db.js";
import { hashPasscode } from "./people.js";

const SEED_PASSCODE = "stand-desk-26";
const SCHEMA_LOCK = 4_173_026;

interface CatalogueSeed {
  id: string;
  title: string;
  composer: string;
  barMap: [number, number, number][];
  letters: [string, number][];
  parts: [string, number, number][];
}

const ALL = (bars: number, ...keys: string[]): [string, number, number][] => keys.map((key) => [key, 1, bars]);
const STRINGS = ["vn1", "vn2", "va", "vc", "cb"];

const PART_NAMES: Record<string, string> = {
  vn1: "Violin I",
  vn2: "Violin II",
  va: "Viola",
  vc: "Cello",
  cb: "Bass",
  fl1: "Flute 1",
  fl2: "Flute 2",
  ob1: "Oboe 1",
  ob2: "Oboe 2",
  cl1: "Clarinet 1",
  cl2: "Clarinet 2",
  bn1: "Bassoon 1",
  bn2: "Bassoon 2",
  hn1: "Horn 1",
  hn2: "Horn 2",
  tp1: "Trumpet 1",
  timp: "Timpani",
  hp: "Harp",
};

const CATALOGUE: CatalogueSeed[] = [
  {
    id: "cw-the-weir",
    title: "The Weir",
    composer: "Edith Marrow",
    barMap: [
      [1, 119, 2400],
      [120, 184, 4123],
      [185, 300, 2500],
    ],
    letters: [["A", 25], ["B", 61], ["C", 97], ["D", 133], ["E", 169], ["F", 205], ["G", 241], ["H", 277]],
    parts: [
      ...ALL(300, ...STRINGS, "fl1", "fl2", "ob1", "ob2", "cl1", "cl2", "bn1", "bn2", "hn1"),
      ["timp", 1, 110],
      ["hp", 185, 300],
    ],
  },
  {
    id: "cw-fen-country-dances",
    title: "Fen Country Dances",
    composer: "Tobias Fenwick",
    barMap: [[1, 410, 3600]],
    letters: [["A", 41], ["B", 81], ["C", 121], ["D", 161], ["E", 201], ["F", 241], ["G", 281], ["H", 321], ["J", 361]],
    parts: ALL(410, ...STRINGS, "fl1", "fl2", "ob1", "ob2", "cl1", "cl2", "bn1", "bn2", "hn1", "hn2", "tp1", "timp"),
  },
  {
    id: "cw-lantern-procession",
    title: "Lantern Procession",
    composer: "Ines Halloran",
    barMap: [[1, 240, 2750]],
    letters: [["A", 33], ["B", 65], ["C", 97], ["D", 129], ["E", 161], ["F", 193], ["G", 225]],
    parts: ALL(240, ...STRINGS, "fl1", "ob1", "cl1", "bn1", "hn1", "hn2", "tp1", "timp"),
  },
  {
    id: "cw-ferry-at-dusk",
    title: "Ferry at Dusk",
    composer: "Edith Marrow",
    barMap: [[1, 180, 2000]],
    letters: [["A", 31], ["B", 61], ["C", 91], ["D", 121], ["E", 151]],
    parts: ALL(180, ...STRINGS, "fl1", "fl2", "ob1", "cl1", "bn1", "hn1"),
  },
  {
    id: "cw-orchard-serenade",
    title: "Orchard Serenade",
    composer: "Ines Halloran",
    barMap: [[1, 200, 3000]],
    letters: [["A", 41], ["B", 81], ["C", 121], ["D", 161]],
    parts: ALL(200, ...STRINGS),
  },
];

const STAFF: [string, string, string][] = [
  ["Rowan Achterberg", "rowan@quirewell.test", "principal_librarian"],
  ["Priya Lindqvist", "priya@quirewell.test", "assistant_librarian"],
  ["Tomasz Ebdon", "tomasz@quirewell.test", "assistant_librarian"],
];

const STRING_ROSTER: [string, string[]][] = [
  ["vn1", ["Hester Quayle", "Anouk Brennan", "Felix Ottaway", "Mireille Sato", "Joachim Varley", "Dagny Moss", "Kwame Ashdown", "Lior Pennick", "Saoirse Thalberg", "Bram Ellery"]],
  ["vn2", ["Odile Farrant", "Casimir Rook", "Yusra Penhaligon", "Ewan Strickland", "Noor Castellane", "Pip Hadley", "Ilse Marchetti", "Tobiah Crane"]],
  ["va", ["Ruairi Delacourt", "Maren Okafor", "Silas Wren", "Agathe Lowry", "Dev Kingsmill", "Juno Halvorsen"]],
  ["vc", ["Clemency Arkwright", "Matthias Obi", "Wren Takahashi", "Esther Galloway", "Leopold Ince"]],
  ["cb", ["Ottilie Brace", "Rafferty Nakamura", "Gwen Abernethy", "Idris Fairweather"]],
];

const SINGLE_CHAIRS: [string, string][] = [
  ["fl1", "Sunniva Pike"],
  ["fl2", "Hollis Drummond"],
  ["ob1", "Marguerite Esk"],
  ["ob2", "Cyrus Bellamy"],
  ["cl1", "Tamsin Vey"],
  ["cl2", "Arlo Mendes"],
  ["bn1", "Philippa Groat"],
  ["bn2", "Emeric Shaw"],
  ["hn1", "Bettany Lusk"],
  ["hn2", "Ansel Morrow"],
  ["tp1", "Kit Ravensworth"],
  ["timp", "Delphine Oakes"],
  ["hp", "Isolde Fenn"],
];

interface ProgrammeSeed {
  id: string;
  number: number;
  title: string;
  status: string;
  rehearsal: number;
  performances: [number, string][];
  count: [number, number, number, number, number];
  works: string[];
  holdings: Record<string, number>;
}

const PROGRAMMES: ProgrammeSeed[] = [
  {
    id: "p01",
    number: 1,
    title: "Rivers and Weirs",
    status: "in_preparation",
    rehearsal: 21,
    performances: [[25, "19:30"], [26, "19:30"]],
    count: [8, 7, 6, 5, 4],
    works: ["cw-the-weir", "cw-fen-country-dances"],
    holdings: { vn1: 5, vn2: 4, va: 3, vc: 3, cb: 2 },
  },
  {
    id: "p02",
    number: 2,
    title: "Winter Lanterns",
    status: "published",
    rehearsal: 5,
    performances: [[8, "19:30"], [9, "14:30"]],
    count: [10, 8, 6, 5, 4],
    works: ["cw-lantern-procession"],
    holdings: { vn1: 6, vn2: 5, va: 3, vc: 3, cb: 2 },
  },
  {
    id: "p03",
    number: 3,
    title: "Spring Overtures",
    status: "draft",
    rehearsal: 60,
    performances: [[64, "19:30"]],
    count: [8, 7, 6, 5, 4],
    works: ["cw-ferry-at-dusk"],
    holdings: {},
  },
  {
    id: "p04",
    number: 4,
    title: "Harvest Serenades",
    status: "closed",
    rehearsal: -24,
    performances: [[-20, "19:30"], [-16, "19:30"]],
    count: [8, 7, 6, 5, 4],
    works: ["cw-orchard-serenade"],
    holdings: { vn1: 5, vn2: 4, va: 3, vc: 3, cb: 2 },
  },
];

/** A seed time `S+days HH:MM` in London time, as an ISO instant. */
function seedTime(seedDate: string, days: number, time: string): string {
  const [year, month, day] = addDays(seedDate, days).split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const instant = wallClockToInstant({ year: year ?? 0, month: month ?? 1, day: day ?? 1, hour: hour ?? 0, minute: minute ?? 0 });
  return new Date(instant ?? 0).toISOString();
}

async function seed(client: pg.PoolClient): Promise<void> {
  const s = londonDate(Date.now());
  const at = (days: number, time: string): string => seedTime(s, days, time);
  const q = (sql: string, params: unknown[]): Promise<unknown> => client.query(sql, params);
  const passcode = hashPasscode(SEED_PASSCODE);
  let order = 0;
  const person = (id: string, name: string, email: string, role: string, key: string | null, num: number | null): Promise<unknown> =>
    q("INSERT INTO people (id, name, email, passcode_hash, role, chair_key, chair_number, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [
      id, name, email, passcode, role, key, num, order++,
    ]);
  for (const [name, email, role] of STAFF) await person(`person-${email.split("@")[0]}`, name, email, role, null, null);
  for (const [key, names] of STRING_ROSTER) {
    for (const [i, name] of names.entries()) {
      const chair = String(i + 1).padStart(2, "0");
      await person(`person-${key}-${chair}`, name, `${key}-${chair}@players.quirewell.test`, i === 0 ? "section_principal" : "player", key, i + 1);
    }
  }
  for (const [key, name] of SINGLE_CHAIRS) await person(`person-${key}`, name, `${key}@players.quirewell.test`, "player", key, null);

  for (const [position, work] of CATALOGUE.entries()) {
    await q("INSERT INTO catalogue_works (id, title, composer, position) VALUES ($1,$2,$3,$4)", [work.id, work.title, work.composer, position]);
    for (const [from, to, ms] of work.barMap) {
      await q("INSERT INTO catalogue_bar_segments VALUES ($1,$2,$3,$4)", [work.id, from, to, ms]);
    }
    for (const [letter, bar] of work.letters) await q("INSERT INTO catalogue_rehearsal_letters VALUES ($1,$2,$3)", [work.id, letter, bar]);
    for (const [i, [key, from, to]] of work.parts.entries()) {
      await q("INSERT INTO catalogue_parts VALUES ($1,$2,$3,$4,$5,$6)", [work.id, key, PART_NAMES[key], from, to, i]);
    }
  }

  for (const programme of PROGRAMMES) {
    const [v1, v2, va, vc, cb] = programme.count;
    await q(
      `INSERT INTO programmes (id, number, title, status, first_rehearsal, violin_1, violin_2, viola, cello, bass)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [programme.id, programme.number, programme.title, programme.status, at(programme.rehearsal, "10:00"), v1, v2, va, vc, cb],
    );
    for (const [days, time] of programme.performances) {
      await q("INSERT INTO performances VALUES ($1,$2)", [programme.id, at(days, time)]);
    }
    for (const [position, catalogueId] of programme.works.entries()) {
      await addCatalogueWork(client, programme.id, catalogueId, position);
      const onHand = (key: string): number => programme.holdings[key] ?? (programme.id === "p03" ? 0 : 1);
      for (const key of Object.keys(PART_NAMES)) {
        await q("UPDATE parts SET copies_on_hand = $1 WHERE id = $2", [onHand(key), `${workId(programme.id, catalogueId)}-${key}`]);
      }
    }
  }

  const lantern = workId("p02", "cw-lantern-procession");
  await q("INSERT INTO cuts (id, work_id, from_bar, to_bar, created_at) VALUES ($1,$2,97,128,$3)", ["cut-p02-lantern-97", lantern, at(-4, "10:00")]);
  await q(
    "INSERT INTO marks (part_id, cut_id, marked_by, marked_at) SELECT id, 'cut-p02-lantern-97', 'person-priya', $2 FROM parts WHERE work_id = $1",
    [lantern, at(-3, "10:00")],
  );
  await q(
    `INSERT INTO notices (programme_id, player_id, status, sent_at)
     SELECT 'p02', id, 'sent', now() FROM people
     WHERE (chair_key IN ('vn1','vn2','va','vc','cb'))
        OR chair_key IN (SELECT chair_key FROM parts WHERE work_id = $1)`,
    [lantern],
  );

  await q("INSERT INTO rental_sets (id, work_id, publisher, status, created_at) VALUES ($1,$2,$3,'in_use',now())", [
    "rs-lantern", lantern, "Hartwell & Rye Music Hire",
  ]);
  const lanternSlip: Record<string, number> = { vn1: 6, vn2: 5, va: 3, vc: 3, cb: 2, fl1: 1, ob1: 1, cl1: 1, bn1: 1, hn1: 1, hn2: 1, tp1: 1, timp: 1 };
  for (const [key, copies] of Object.entries(lanternSlip)) {
    await q("INSERT INTO slip_lines (rental_set_id, part_id, copies, checked_in) VALUES ('rs-lantern',$1,$2,0)", [`${lantern}-${key}`, copies]);
  }
  const orchard = workId("p04", "cw-orchard-serenade");
  await q("INSERT INTO rental_sets (id, work_id, publisher, status, created_at) VALUES ($1,$2,$3,'in_use',now())", [
    "rs-orchard", orchard, "Calder Press Hire Library",
  ]);
  const orchardSlip: Record<string, [number, number]> = { vn1: [5, 5], vn2: [4, 4], va: [3, 3], vc: [3, 2], cb: [2, 2] };
  for (const [key, [copies, back]] of Object.entries(orchardSlip)) {
    await q("INSERT INTO slip_lines (rental_set_id, part_id, copies, checked_in) VALUES ('rs-orchard',$1,$2,$3)", [`${orchard}-${key}`, copies, back]);
  }
  await q(
    "INSERT INTO reminders (rental_set_id, assistant_id, status, sent_at) SELECT 'rs-orchard', id, 'sent', now() FROM people WHERE role = 'assistant_librarian'",
    [],
  );
}

/** `<programme id>-<catalogue id without "cw-">`. */
function workId(programmeId: string, catalogueId: string): string {
  return `${programmeId}-${catalogueId.replace(/^cw-/, "")}`;
}

/** Copies a catalogue work's bar map, rehearsal letters and parts into a programme, with no copies on hand. */
export async function addCatalogueWork(client: pg.PoolClient, programmeId: string, catalogueId: string, position: number): Promise<string> {
  const id = workId(programmeId, catalogueId);
  await client.query(
    `INSERT INTO works (id, programme_id, catalogue_work_id, title, composer, position)
     SELECT $1, $2, id, title, composer, $3 FROM catalogue_works WHERE id = $4`,
    [id, programmeId, position, catalogueId],
  );
  await client.query(
    "INSERT INTO bar_segments (work_id, from_bar, to_bar, bar_ms) SELECT $1, from_bar, to_bar, bar_ms FROM catalogue_bar_segments WHERE catalogue_work_id = $2",
    [id, catalogueId],
  );
  await client.query(
    "INSERT INTO rehearsal_letters (work_id, letter, bar) SELECT $1, letter, bar FROM catalogue_rehearsal_letters WHERE catalogue_work_id = $2",
    [id, catalogueId],
  );
  await client.query(
    `INSERT INTO parts (id, work_id, chair_key, name, bars_from, bars_to, position, copies_on_hand)
     SELECT $1 || '-' || chair_key, $1, chair_key, name, bars_from, bars_to, position, 0 FROM catalogue_parts WHERE catalogue_work_id = $2`,
    [id, catalogueId],
  );
  return id;
}

/** Applies the schema and, on an empty database, the seed records. */
export async function prepareDatabase(client: pg.PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
  try {
    await client.query(SCHEMA);
    const { rows } = await client.query<{ empty: boolean }>("SELECT NOT EXISTS (SELECT 1 FROM people) AS empty");
    if (rows[0]?.empty) {
      await client.query("BEGIN");
      try {
        await seed(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
  }
}
