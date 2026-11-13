// Seeding. The records are written only when the database is empty.

import { Pool } from "pg";
import { wallToInstant, instantToLondon } from "../shared/london.js";

interface SeedPart {
  name: string;
  chairKey: string;
  barsFrom: number;
  barsTo: number;
}

interface SeedWork {
  id: string;
  title: string;
  composer: string;
  barMap: [number, number, number][];
  letters: [string, number][];
  parts: SeedPart[];
}

function full(name: string, chairKey: string, bars: number): SeedPart {
  return { name, chairKey, barsFrom: 1, barsTo: bars };
}

function range(name: string, chairKey: string, from: number, to: number): SeedPart {
  return { name, chairKey, barsFrom: from, barsTo: to };
}

const CATALOGUE: SeedWork[] = [
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
      full("Violin I", "vn1", 300),
      full("Violin II", "vn2", 300),
      full("Viola", "va", 300),
      full("Cello", "vc", 300),
      full("Bass", "cb", 300),
      full("Flute 1", "fl1", 300),
      full("Flute 2", "fl2", 300),
      full("Oboe 1", "ob1", 300),
      full("Oboe 2", "ob2", 300),
      full("Clarinet 1", "cl1", 300),
      full("Clarinet 2", "cl2", 300),
      full("Bassoon 1", "bn1", 300),
      full("Bassoon 2", "bn2", 300),
      full("Horn 1", "hn1", 300),
      range("Timpani", "timp", 1, 110),
      range("Harp", "hp", 185, 300),
    ],
  },
  {
    id: "cw-fen-country-dances",
    title: "Fen Country Dances",
    composer: "Tobias Fenwick",
    barMap: [[1, 410, 3600]],
    letters: [["A", 41], ["B", 81], ["C", 121], ["D", 161], ["E", 201], ["F", 241], ["G", 281], ["H", 321], ["J", 361]],
    parts: [
      full("Violin I", "vn1", 410),
      full("Violin II", "vn2", 410),
      full("Viola", "va", 410),
      full("Cello", "vc", 410),
      full("Bass", "cb", 410),
      full("Flute 1", "fl1", 410),
      full("Flute 2", "fl2", 410),
      full("Oboe 1", "ob1", 410),
      full("Oboe 2", "ob2", 410),
      full("Clarinet 1", "cl1", 410),
      full("Clarinet 2", "cl2", 410),
      full("Bassoon 1", "bn1", 410),
      full("Bassoon 2", "bn2", 410),
      full("Horn 1", "hn1", 410),
      full("Horn 2", "hn2", 410),
      full("Trumpet 1", "tp1", 410),
      full("Timpani", "timp", 410),
    ],
  },
  {
    id: "cw-lantern-procession",
    title: "Lantern Procession",
    composer: "Ines Halloran",
    barMap: [[1, 240, 2750]],
    letters: [["A", 33], ["B", 65], ["C", 97], ["D", 129], ["E", 161], ["F", 193], ["G", 225]],
    parts: [
      full("Violin I", "vn1", 240),
      full("Violin II", "vn2", 240),
      full("Viola", "va", 240),
      full("Cello", "vc", 240),
      full("Bass", "cb", 240),
      full("Flute 1", "fl1", 240),
      full("Oboe 1", "ob1", 240),
      full("Clarinet 1", "cl1", 240),
      full("Bassoon 1", "bn1", 240),
      full("Horn 1", "hn1", 240),
      full("Horn 2", "hn2", 240),
      full("Trumpet 1", "tp1", 240),
      full("Timpani", "timp", 240),
    ],
  },
  {
    id: "cw-ferry-at-dusk",
    title: "Ferry at Dusk",
    composer: "Edith Marrow",
    barMap: [[1, 180, 2000]],
    letters: [["A", 31], ["B", 61], ["C", 91], ["D", 121], ["E", 151]],
    parts: [
      full("Violin I", "vn1", 180),
      full("Violin II", "vn2", 180),
      full("Viola", "va", 180),
      full("Cello", "vc", 180),
      full("Bass", "cb", 180),
      full("Flute 1", "fl1", 180),
      full("Flute 2", "fl2", 180),
      full("Oboe 1", "ob1", 180),
      full("Clarinet 1", "cl1", 180),
      full("Bassoon 1", "bn1", 180),
      full("Horn 1", "hn1", 180),
    ],
  },
  {
    id: "cw-orchard-serenade",
    title: "Orchard Serenade",
    composer: "Ines Halloran",
    barMap: [[1, 200, 3000]],
    letters: [["A", 41], ["B", 81], ["C", 121], ["D", 161]],
    parts: [
      full("Violin I", "vn1", 200),
      full("Violin II", "vn2", 200),
      full("Viola", "va", 200),
      full("Cello", "vc", 200),
      full("Bass", "cb", 200),
    ],
  },
];

const STRING_SECTIONS: { key: string; section: string; names: string[] }[] = [
  { key: "vn1", section: "violin_1", names: ["Hester Quayle", "Anouk Brennan", "Felix Ottaway", "Mireille Sato", "Joachim Varley", "Dagny Moss", "Kwame Ashdown", "Lior Pennick", "Saoirse Thalberg", "Bram Ellery"] },
  { key: "vn2", section: "violin_2", names: ["Odile Farrant", "Casimir Rook", "Yusra Penhaligon", "Ewan Strickland", "Noor Castellane", "Pip Hadley", "Ilse Marchetti", "Tobiah Crane"] },
  { key: "va", section: "viola", names: ["Ruairi Delacourt", "Maren Okafor", "Silas Wren", "Agathe Lowry", "Dev Kingsmill", "Juno Halvorsen"] },
  { key: "vc", section: "cello", names: ["Clemency Arkwright", "Matthias Obi", "Wren Takahashi", "Esther Galloway", "Leopold Ince"] },
  { key: "cb", section: "bass", names: ["Ottilie Brace", "Rafferty Nakamura", "Gwen Abernethy", "Idris Fairweather"] },
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

const PART_NAMES: Record<string, string> = {
  vn1: "Violin I", vn2: "Violin II", va: "Viola", vc: "Cello", cb: "Bass",
  fl1: "Flute 1", fl2: "Flute 2", ob1: "Oboe 1", ob2: "Oboe 2",
  cl1: "Clarinet 1", cl2: "Clarinet 2", bn1: "Bassoon 1", bn2: "Bassoon 2",
  hn1: "Horn 1", hn2: "Horn 2", tp1: "Trumpet 1", timp: "Timpani", hp: "Harp",
};

const PASSCODE = "stand-desk-26";

/** The instant of London midnight on the day the seed is written. */
function businessDayStart(): number {
  const now = Date.now();
  const wall = instantToLondon(now);
  const at = wallToInstant({ year: wall.year, month: wall.month, day: wall.day, hour: 0, minute: 0, second: 0 });
  return at.kind === "ok" ? at.instant : now;
}

/** A seeded London wall-clock time: midnight of S plus days, at hour and minute. */
function seededInstant(seedDay: number, days: number, hour: number, minute: number): number {
  const base = instantToLondon(seedDay);
  const wall = wallToInstant({
    year: base.year,
    month: base.month,
    day: base.day + days,
    hour,
    minute,
    second: 0,
  });
  return wall.kind === "ok" ? wall.instant : seedDay + days * 86400000 + hour * 3600000 + minute * 60000;
}

export async function seedIfEmpty(pool: Pool): Promise<void> {
  const existing = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM people");
  if (existing.rows[0].n > 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const S = businessDayStart();

    const staff: [string, string, string, string][] = [
      ["rowan", "Rowan Achterberg", "rowan@quirewell.test", "principal_librarian"],
      ["priya", "Priya Lindqvist", "priya@quirewell.test", "assistant_librarian"],
      ["tomasz", "Tomasz Ebdon", "tomasz@quirewell.test", "assistant_librarian"],
    ];
    for (const [id, name, email, role] of staff) {
      await client.query(
        "INSERT INTO people (id,name,email,passcode,role,chair_key,chair_label) VALUES ($1,$2,$3,$4,$5,$6,$6)",
        [id, name, email, PASSCODE, role, id]
      );
    }

    for (const group of STRING_SECTIONS) {
      for (const [index, name] of group.names.entries()) {
        const number = index + 1;
        const id = `${group.key}-${String(number).padStart(2, "0")}`;
        const role = number === 1 ? "section_principal" : "player";
        const label =
          number === 1
            ? PART_NAMES[group.key]
            : `${PART_NAMES[group.key]} · chair ${String(number).padStart(2, "0")}`;
        await client.query(
          "INSERT INTO people (id,name,email,passcode,role,chair_key,chair_section,chair_number,chair_label) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [id, name, `${id}@players.quirewell.test`, PASSCODE, role, group.key, group.section, number, label]
        );
      }
    }
    for (const [key, name] of SINGLE_CHAIRS) {
      await client.query(
        "INSERT INTO people (id,name,email,passcode,role,chair_key,chair_label) VALUES ($1,$2,$3,$4,'player',$5,$6)",
        [key, name, `${key}@players.quirewell.test`, PASSCODE, key, PART_NAMES[key]]
      );
    }

    for (const work of CATALOGUE) {
      const bars = work.barMap[work.barMap.length - 1][1];
      const totalMs = work.barMap.reduce((sum, [from, to, ms]) => sum + (to - from + 1) * ms, 0);
      await client.query(
        "INSERT INTO catalogue_works (id,title,composer,bars,running_time_ms) VALUES ($1,$2,$3,$4,$5)",
        [work.id, work.title, work.composer, bars, totalMs]
      );
      for (const [from, to, ms] of work.barMap) {
        await client.query(
          "INSERT INTO catalogue_bar_map (catalogue_work_id,from_bar,to_bar,bar_ms) VALUES ($1,$2,$3,$4)",
          [work.id, from, to, ms]
        );
      }
      for (const [letter, bar] of work.letters) {
        await client.query(
          "INSERT INTO catalogue_letters (catalogue_work_id,letter,bar) VALUES ($1,$2,$3)",
          [work.id, letter, bar]
        );
      }
      for (const part of work.parts) {
        await client.query(
          "INSERT INTO catalogue_parts (catalogue_work_id,name,chair_key,bars_from,bars_to) VALUES ($1,$2,$3,$4,$5)",
          [work.id, part.name, part.chairKey, part.barsFrom, part.barsTo]
        );
      }
    }

    interface SeedProgramme {
      id: string;
      number: number;
      title: string;
      status: string;
      first: number;
      performances: number[];
      count: [number, number, number, number, number];
      works: string[];
      holdings: Record<string, number>;
      defaultOnHand: number;
    }
    const programmes: SeedProgramme[] = [
      {
        id: "p01", number: 1, title: "Rivers and Weirs", status: "in_preparation",
        first: seededInstant(S, 21, 10, 0),
        performances: [seededInstant(S, 25, 19, 30), seededInstant(S, 26, 19, 30)],
        count: [8, 7, 6, 5, 4], works: ["cw-the-weir", "cw-fen-country-dances"],
        holdings: { vn1: 5, vn2: 4, va: 3, vc: 3, cb: 2 }, defaultOnHand: 1,
      },
      {
        id: "p02", number: 2, title: "Winter Lanterns", status: "published",
        first: seededInstant(S, 5, 10, 0),
        performances: [seededInstant(S, 8, 19, 30), seededInstant(S, 9, 14, 30)],
        count: [10, 8, 6, 5, 4], works: ["cw-lantern-procession"],
        holdings: { vn1: 6, vn2: 5, va: 3, vc: 3, cb: 2 }, defaultOnHand: 1,
      },
      {
        id: "p03", number: 3, title: "Spring Overtures", status: "draft",
        first: seededInstant(S, 60, 10, 0),
        performances: [seededInstant(S, 64, 19, 30)],
        count: [8, 7, 6, 5, 4], works: ["cw-ferry-at-dusk"],
        holdings: {}, defaultOnHand: 0,
      },
      {
        id: "p04", number: 4, title: "Harvest Serenades", status: "closed",
        first: seededInstant(S, -24, 10, 0),
        performances: [seededInstant(S, -20, 19, 30), seededInstant(S, -16, 19, 30)],
        count: [8, 7, 6, 5, 4], works: ["cw-orchard-serenade"],
        holdings: { vn1: 5, vn2: 4, va: 3, vc: 3, cb: 2 }, defaultOnHand: 1,
      },
    ];

    for (const p of programmes) {
      await client.query(
        "INSERT INTO programmes (id,number,title,status,first_rehearsal,violin_1,violin_2,viola,cello,bass) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [p.id, p.number, p.title, p.status, new Date(p.first), ...p.count]
      );
      for (const at of p.performances) {
        await client.query("INSERT INTO performances (programme_id,at) VALUES ($1,$2)", [p.id, new Date(at)]);
      }
      for (const [position, catalogueId] of p.works.entries()) {
        const catalogue = CATALOGUE.find((w) => w.id === catalogueId);
        if (!catalogue) throw new Error(`unknown catalogue work ${catalogueId}`);
        const workId = `${p.id}-${catalogueId.replace("cw-", "")}`;
        const bars = catalogue.barMap[catalogue.barMap.length - 1][1];
        await client.query(
          "INSERT INTO works (id,programme_id,catalogue_work_id,position,bars) VALUES ($1,$2,$3,$4,$5)",
          [workId, p.id, catalogueId, position, bars]
        );
        for (const [from, to, ms] of catalogue.barMap) {
          await client.query("INSERT INTO bar_map (work_id,from_bar,to_bar,bar_ms) VALUES ($1,$2,$3,$4)", [
            workId, from, to, ms,
          ]);
        }
        for (const [letter, bar] of catalogue.letters) {
          await client.query("INSERT INTO rehearsal_letters (work_id,letter,bar) VALUES ($1,$2,$3)", [
            workId, letter, bar,
          ]);
        }
        for (const part of catalogue.parts) {
          const onHand = p.holdings[part.chairKey] ?? p.defaultOnHand;
          await client.query(
            "INSERT INTO parts (id,work_id,name,chair_key,bars_from,bars_to,copies_on_hand) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [`${workId}-${part.chairKey}`, workId, part.name, part.chairKey, part.barsFrom, part.barsTo, onHand]
          );
        }
      }
    }

    // Programme 02's cut and its marks for all 13 parts.
    await client.query("INSERT INTO cuts (id,work_id,from_bar,to_bar,created_at) VALUES ($1,$2,$3,$4,$5)", [
      "cut-lantern-97-128", "p02-lantern-procession", 97, 128, new Date(seededInstant(S, -4, 10, 0)),
    ]);
    const lanternParts = await client.query<{ id: string }>("SELECT id FROM parts WHERE work_id='p02-lantern-procession'");
    for (const row of lanternParts.rows) {
      await client.query(
        "INSERT INTO marks (part_id,cut_id,marked_by,marked_at) VALUES ($1,$2,'priya',$3)",
        [row.id, "cut-lantern-97-128", new Date(seededInstant(S, -3, 10, 0))]
      );
    }

    // Programme 02's notice rows: one per seated player, recorded as sent.
    const seated = await client.query<{ id: string }>(
      `SELECT id FROM people WHERE role IN ('section_principal','player') AND (
         (chair_section='violin_1' AND chair_number<=10) OR
         (chair_section='violin_2' AND chair_number<=8) OR
         (chair_section='viola' AND chair_number<=6) OR
         (chair_section='cello' AND chair_number<=5) OR
         (chair_section='bass' AND chair_number<=4) OR
         (chair_key IN ('fl1','ob1','cl1','bn1','hn1','hn2','tp1','timp'))
       )`
    );
    const seededAt = new Date();
    for (const row of seated.rows) {
      await client.query(
        "INSERT INTO notices (programme_id,player_id,status,sent_at) VALUES ('p02',$1,'sent',$2)",
        [row.id, seededAt]
      );
    }

    // Rental sets.
    await client.query(
      "INSERT INTO rental_sets (id,work_id,publisher,status) VALUES ('rs-lantern','p02-lantern-procession','Hartwell & Rye Music Hire','in_use')"
    );
    const lanternSlip: [string, number][] = [
      ["p02-lantern-procession-vn1", 6], ["p02-lantern-procession-vn2", 5],
      ["p02-lantern-procession-va", 3], ["p02-lantern-procession-vc", 3],
      ["p02-lantern-procession-cb", 2], ["p02-lantern-procession-fl1", 1],
      ["p02-lantern-procession-ob1", 1], ["p02-lantern-procession-cl1", 1],
      ["p02-lantern-procession-bn1", 1], ["p02-lantern-procession-hn1", 1],
      ["p02-lantern-procession-hn2", 1], ["p02-lantern-procession-tp1", 1],
      ["p02-lantern-procession-timp", 1],
    ];
    for (const [index, [partId, copies]] of lanternSlip.entries()) {
      await client.query(
        "INSERT INTO rental_slip (rental_set_id,part_id,position,copies,checked_in) VALUES ('rs-lantern',$1,$2,$3,0)",
        [partId, index, copies]
      );
    }
    await client.query(
      "INSERT INTO rental_sets (id,work_id,publisher,status,reminder_status,reminder_sent_at) VALUES ('rs-orchard','p04-orchard-serenade','Calder Press Hire Library','in_use','sent',$1)",
      [seededAt]
    );
    const orchardSlip: [string, number, number][] = [
      ["p04-orchard-serenade-vn1", 5, 5], ["p04-orchard-serenade-vn2", 4, 4],
      ["p04-orchard-serenade-va", 3, 3], ["p04-orchard-serenade-vc", 3, 2],
      ["p04-orchard-serenade-cb", 2, 2],
    ];
    for (const [index, [partId, copies, checkedIn]] of orchardSlip.entries()) {
      await client.query(
        "INSERT INTO rental_slip (rental_set_id,part_id,position,copies,checked_in) VALUES ('rs-orchard',$1,$2,$3,$4)",
        [partId, index, copies, checkedIn]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
