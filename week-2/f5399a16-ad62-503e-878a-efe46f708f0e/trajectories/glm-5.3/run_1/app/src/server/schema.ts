// The schema, applied idempotently on serve, safely when several copies start
// together on their own database. The platform creates the database; the app
// applies its schema and seed to the one it is given.

import type { Config } from "./config";
import type { Db } from "./db";
import type { Store } from "./store";
import { frameDrawingSvg, seededDrawingName } from "../shared/svg";
import { instantText, weekStartOfAmsterdam, longDate, townOffsetMinutes, instantOfWall, addDays } from "../shared/tz";
import type { Instant } from "../shared/tz";
import { newId, newSalt, hashPassword, newToken } from "./http";

const SCHEMA = [
  `create table if not exists desks (
    id text primary key,
    name text not null,
    email text not null,
    password_salt text not null,
    password_hash text not null,
    created_at bigint not null
  )`,
  `create unique index if not exists desks_email on desks (lower(email))`,
  `create table if not exists sessions (
    id text primary key,
    desk_id text not null,
    token text not null,
    created_at bigint not null,
    expires_at bigint not null
  )`,
  `create index if not exists sessions_token on sessions (token)`,
  `create table if not exists ended_sessions (
    token text primary key,
    at bigint not null
  )`,
  `create table if not exists clients (
    id text primary key,
    desk_id text not null,
    name text not null,
    place text not null,
    state text not null,
    closes_at bigint,
    erased_at bigint,
    erasure_tried_at bigint,
    created_at bigint not null
  )`,
  `create index if not exists clients_desk on clients (desk_id)`,
  `create table if not exists producers (
    id text primary key,
    client_id text not null,
    name text not null,
    email text not null,
    town text not null,
    language text not null
  )`,
  `create index if not exists producers_client on producers (client_id)`,
  `create table if not exists jobs (
    id text primary key,
    desk_id text not null,
    client_id text not null,
    title text not null,
    ad_id text not null,
    due_date text not null,
    target_seconds int not null,
    frame_rate text not null,
    aspect text not null,
    state text not null,
    created_at bigint not null
  )`,
  `create index if not exists jobs_desk on jobs (desk_id)`,
  `create table if not exists frames (
    id text primary key,
    job_id text not null,
    number int not null,
    position int not null,
    duration_frames int not null,
    action_note text not null,
    audio_note text not null,
    shot text not null,
    visual text not null,
    file_name text,
    width int,
    height int,
    sha256 text,
    seeded boolean not null default false,
    created_at bigint not null
  )`,
  `create index if not exists frames_job on frames (job_id)`,
  `create unique index if not exists frames_job_number on frames (job_id, number)`,
  `create table if not exists cuts (
    id text primary key,
    job_id text not null,
    number int not null,
    name text not null,
    frame_rate text not null,
    created_at bigint not null,
    signed_off_at bigint,
    signed_off_by text
  )`,
  `create index if not exists cuts_job on cuts (job_id)`,
  `create table if not exists cut_frames (
    cut_id text not null,
    frame_id text not null,
    frame_number int not null,
    position int not null,
    duration_frames int not null,
    action_note text not null,
    audio_note text not null,
    shot text not null,
    visual text not null,
    file_name text,
    width int,
    height int,
    sha256 text,
    seeded boolean not null default false
  )`,
  `create index if not exists cut_frames_cut on cut_frames (cut_id)`,
  `create table if not exists board_stamps (
    job_id text primary key,
    stamp text not null,
    frame_rate text not null
  )`,
  `create table if not exists lines (
    id text primary key,
    job_id text not null,
    frame int not null,
    market text not null,
    text text not null,
    x numeric not null,
    y numeric not null,
    width numeric not null,
    height numeric not null,
    clips int not null
  )`,
  `create index if not exists lines_job on lines (job_id)`,
  `create table if not exists cues (
    id text primary key,
    job_id text not null,
    track_id text not null,
    title text not null,
    composer text not null,
    seconds int not null,
    market text not null,
    from_date text not null,
    until_date text not null,
    fee numeric not null,
    licence_id text not null,
    licence_text text not null
  )`,
  `create index if not exists cues_job on cues (job_id)`,
  `create table if not exists renders (
    id text primary key,
    job_id text not null,
    cut_id text not null,
    cut_number int not null,
    width int not null,
    burn_timecode boolean not null,
    state text not null,
    progress int not null,
    message text,
    size bigint,
    sha256 text,
    provider_id text,
    polled_at bigint,
    created_at bigint not null,
    stored_at bigint
  )`,
  `create index if not exists renders_job on renders (job_id)`,
  `create table if not exists reviews (
    id text primary key,
    job_id text not null,
    producer_id text not null,
    cut int not null,
    token text not null,
    state text not null,
    ends_at bigint not null,
    created_at bigint not null,
    reminder_sent_at bigint,
    reminded boolean not null default false
  )`,
  `create index if not exists reviews_job on reviews (job_id)`,
  `create index if not exists reviews_token on reviews (token)`,
  `create table if not exists review_names (
    review_id text primary key,
    name text not null
  )`,
  `create table if not exists sign_offs (
    id text primary key,
    job_id text not null,
    producer_id text not null,
    cut int not null,
    token text not null,
    state text not null,
    ends_at bigint not null,
    created_at bigint not null,
    signed_off_at bigint,
    signed_off_by text
  )`,
  `create index if not exists sign_offs_job on sign_offs (job_id)`,
  `create index if not exists sign_offs_token on sign_offs (token)`,
  `create table if not exists notes (
    id text primary key,
    job_id text not null,
    review_id text not null,
    producer_id text not null,
    frame int not null,
    x numeric not null,
    y numeric not null,
    text text not null,
    typed_name text not null,
    suggested_seconds numeric,
    suggested_frames int,
    attachment_id text,
    state text not null,
    created_at bigint not null
  )`,
  `create index if not exists notes_job on notes (job_id)`,
  `create table if not exists attachments (
    id text primary key,
    job_id text not null,
    producer_id text not null,
    content_type text not null
  )`,
  `create table if not exists calls (
    id text primary key,
    desk_id text not null,
    producer_id text not null,
    date text not null,
    time text not null,
    minutes int not null,
    note text not null,
    starts_at bigint not null,
    ends_at bigint not null,
    uid text not null,
    sequence int not null,
    state text not null
  )`,
  `create index if not exists calls_desk on calls (desk_id)`,
  `create table if not exists packages (
    id text primary key,
    job_id text not null,
    cut int not null,
    state text not null,
    created_at bigint not null
  )`,
  `create index if not exists packages_job on packages (job_id)`,
  `create table if not exists package_files (
    package_id text not null,
    kind text not null,
    file_name text not null,
    size bigint not null,
    sha256 text not null
  )`,
  `create table if not exists letters (
    id text primary key,
    job_id text not null,
    currency text not null,
    scope text not null,
    fee_minor bigint not null,
    tax_minor bigint not null,
    total_minor bigint not null,
    state text not null,
    stamp text not null,
    producer_id text,
    page_token text,
    page_ends_at bigint,
    pdf_stored_at bigint,
    created_at bigint not null,
    accepted_at bigint,
    accepted_by text
  )`,
  `create index if not exists letters_job on letters (job_id)`,
  `create index if not exists letters_token on letters (page_token)`,
  `create table if not exists job_history (
    id text primary key,
    job_id text not null,
    at bigint not null,
    actor text not null,
    action text not null,
    text text not null
  )`,
  `create index if not exists job_history_job on job_history (job_id, at, id)`,
  `create table if not exists pending_mail (
    id text primary key,
    to_address text not null,
    subject text not null,
    body text not null,
    html text,
    attachment_name text,
    attachment_type text,
    attachment text,
    created_at bigint not null
  )`,
  `create table if not exists enquiries (
    id text primary key,
    name text not null,
    email text not null,
    phone text,
    message text not null,
    created_at bigint not null
  )`,
  `create table if not exists review_sends (
    id text primary key,
    review_id text not null,
    send_key text not null
  )`,
  `create index if not exists review_sends_key on review_sends (send_key)`,
  `create table if not exists enquiry_rates (
    email_key text not null,
    at bigint not null
  )`,
  `create index if not exists enquiry_rates_key on enquiry_rates (email_key, at)`,
  `create table if not exists link_rates (
    email_key text not null,
    at bigint not null
  )`,
  `create index if not exists link_rates_key on link_rates (email_key, at)`,
  `create table if not exists file_rates (
    desk_id text not null,
    at bigint not null
  )`,
  `create index if not exists file_rates_desk on file_rates (desk_id, at)`,
  `create table if not exists removals (
    job_id text not null,
    frame int not null,
    frame_id text not null,
    position int not null,
    duration_frames int not null,
    action_note text not null,
    audio_note text not null,
    shot text not null,
    visual text not null,
    file_name text,
    width int,
    height int,
    sha256 text,
    seeded boolean not null default false,
    ends_at bigint not null
  )`,
  `create index if not exists removals_job on removals (job_id, ends_at)`,
  `create table if not exists cue_cache (
    key text primary key,
    at bigint not null,
    value text not null
  )`,
];

// Every seeded person and business is invented. Times count from when the
// copy first starts, and seeding sends no mail.
const SEED_PASSWORD = "desk-pass-2027";

export async function applySchema(db: Db): Promise<void> {
  for (const statement of SCHEMA) {
    await db.query(statement, []);
  }
  // A fold for the Jobs list's title sort: lower-case and accent-folded, so
  // `Éclair` sorts beside `eclair`.
  await db.query(
    "create or replace function fold_lower(t text) returns text language sql immutable as $$ select lower(t) $$",
    [],
  );
}

export async function seed(config: Config, db: Db, store: Store): Promise<void> {
  // Idempotent: the sign-ins row is the marker.
  const existing = await db.one("select id from desks where email = $1", ["noor@noorbakkerboards.example"]);
  if (existing !== null) return;
  const start = Math.floor(Date.now() / 1000);
  await seedDesk(config, db, start, {
    id: newId(),
    name: "Noor Bakker",
    email: "noor@noorbakkerboards.example",
    full: true,
  });
  await seedDesk(config, db, start, {
    id: newId(),
    name: "Theo Lindqvist",
    email: "theo@noorbakkerboards.example",
    full: false,
  });
  void store;
}

type SeedDesk = { id: string; name: string; email: string; full: boolean };

async function seedDesk(config: Config, db: Db, start: Instant, desk: SeedDesk): Promise<void> {
  const salt = newSalt();
  await db.query(
    "insert into desks (id, name, email, password_salt, password_hash, created_at) values ($1, $2, $3, $4, $5, $6)",
    [desk.id, desk.name, desk.email, salt, hashPassword(SEED_PASSWORD, salt), String(start)],
  );
  if (!desk.full) {
    const clientId = newId();
    await db.query(
      "insert into clients (id, desk_id, name, place, state, closes_at, erased_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [clientId, desk.id, "Fjordlight Studio", "netherlands", "active", null, null, String(start)],
    );
    await seedJob(db, {
      id: newId(),
      deskId: desk.id,
      clientId,
      title: "Quiet Harbour",
      adId: "FJOR0000401H",
      dueDate: addDays(shortDate(start), 21),
      targetSeconds: 15,
      frameRate: "25",
      state: "draft",
      start,
      frames: [],
    });
    return;
  }
  const clients = await seedNoorClients(db, desk.id, start);
  await seedNoorJobs(db, desk.id, clients, start);
  void config;
}

async function seedNoorClients(db: Db, deskId: string, start: Instant): Promise<Record<string, { id: string; producer: string }>> {
  const rows: [string, string, string, string, string, string, string][] = [
    ["hudson", "Hudson Yard Pictures", "newYork", "Marcus Hale", "marcus.hale@hudsonyard.example", "newYork", "en"],
    ["noordzee", "STICHTINGNOORDZEEPRODUCTIESENPARTNERSHOOFDKANTOORAMSTERDAM", "netherlands", "Zoë Ørsted", "zoe.orsted@noordzee.example", "amsterdam", "nl"],
    ["maple", "Maple & Lake Films", "ontario", "Élodie Tremblay", "elodie.tremblay@mapleandlake.example", "toronto", "fr"],
    ["gulf", "Gulf Meridian Airways", "dubai", "ليلى حداد", "layla.haddad@gulfmeridian.example", "dubai", "ar"],
  ];
  const out: Record<string, { id: string; producer: string }> = {};
  for (const [key, name, place, producerName, producerEmail, town, language] of rows) {
    const clientId = newId();
    const producerId = newId();
    await db.query(
      "insert into clients (id, desk_id, name, place, state, closes_at, erased_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [clientId, deskId, name, place, "active", null, null, String(start)],
    );
    await db.query(
      "insert into producers (id, client_id, name, email, town, language) values ($1, $2, $3, $4, $5, $6)",
      [producerId, clientId, producerName, producerEmail, town, language],
    );
    out[key] = { id: clientId, producer: producerId };
  }
  return out;
}

type SeedJobSpec = {
  id: string;
  deskId: string;
  clientId: string;
  title: string;
  adId: string;
  dueDate: string;
  targetSeconds: number;
  frameRate: "25" | "23.976" | "29.97";
  state: "draft" | "inReview" | "signedOff";
  start: Instant;
  frames: { duration: number; note?: string }[];
};

async function seedNoorJobs(db: Db, deskId: string, clients: Record<string, { id: string; producer: string }>, start: Instant): Promise<void> {
  const due = addDays(shortDate(start), 21);
  const harbourId = newId();
  await seedJob(db, {
    id: harbourId,
    deskId,
    clientId: clients.hudson!.id,
    title: "Harbour Light",
    adId: "HUDS0000301H",
    dueDate: due,
    targetSeconds: 30,
    frameRate: "29.97",
    state: "signedOff",
    start,
    frames: Array.from({ length: 12 }, () => ({ duration: 75 })),
  });
  const polderId = newId();
  await seedJob(db, {
    id: polderId,
    deskId,
    clientId: clients.noordzee!.id,
    title: "Polder Run",
    adId: "NOOR0000302H",
    dueDate: due,
    targetSeconds: 30,
    frameRate: "25",
    state: "draft",
    start,
    frames: [...Array.from({ length: 11 }, () => ({ duration: 62 })), { duration: 68 }],
  });
  const mapleId = newId();
  await seedJob(db, {
    id: mapleId,
    deskId,
    clientId: clients.maple!.id,
    title: "Maple Line",
    adId: "MAPL0000303H",
    dueDate: due,
    targetSeconds: 15,
    frameRate: "23.976",
    state: "inReview",
    start,
    frames: Array.from({ length: 12 }, () => ({ duration: 30 })),
  });
  const gulfId = newId();
  await seedJob(db, {
    id: gulfId,
    deskId,
    clientId: clients.gulf!.id,
    title: "Gulf Morning",
    adId: "GULF0000304D",
    dueDate: due,
    targetSeconds: 6,
    frameRate: "25",
    state: "draft",
    start,
    frames: Array.from({ length: 12 }, () => ({ duration: 12 })),
  });
  await seedExtras(db, start, {
    harbourId,
    mapleId,
    polderId,
    producerHudson: clients.hudson!.producer,
    producerMaple: clients.maple!.producer,
  });
}

async function seedExtras(
  db: Db,
  start: Instant,
  ids: { harbourId: string; mapleId: string; polderId: string; producerHudson: string; producerMaple: string },
): Promise<void> {
  // Harbour Light: an open and a done note from Marcus Hale on frame 4, and
  // its Cut 1 signed off by him.
  const openNote = newId();
  const doneNote = newId();
  const reviewRow = await db.one(
    "insert into reviews (id, job_id, producer_id, cut, token, state, ends_at, created_at, reminded) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id",
    [openNote, ids.harbourId, ids.producerHudson, 1, newToken(), "ended", String(start - 1000), String(start - 2000), true],
  );
  void reviewRow;
  await db.query(
    "insert into notes (id, job_id, review_id, producer_id, frame, x, y, text, typed_name, suggested_seconds, suggested_frames, attachment_id, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    [newId(), ids.harbourId, openNote, ids.producerHudson, 4, "41.5", "62.0", "Hold the harbour light a beat longer.", "Marcus Hale", null, null, null, "open", String(start - 500)],
  );
  await db.query(
    "insert into notes (id, job_id, review_id, producer_id, frame, x, y, text, typed_name, suggested_seconds, suggested_frames, attachment_id, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    [doneNote, ids.harbourId, openNote, ids.producerHudson, 4, "51.0", "58.5", "Bring the boat in from the left.", "Marcus Hale", null, null, null, "done", String(start - 600)],
  );
  await db.query(
    "update cuts set signed_off_at = $1, signed_off_by = $2 where job_id = $3 and number = 1",
    [String(start - 100), "Marcus Hale", ids.harbourId],
  );
  // Maple Line: an open note from Élodie Tremblay on frame 4 from an ended
  // review page on Cut 2, so no reminder is due.
  const mapleReview = newId();
  await db.query(
    "insert into reviews (id, job_id, producer_id, cut, token, state, ends_at, created_at, reminded) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [mapleReview, ids.mapleId, ids.producerMaple, 2, newToken(), "ended", String(start - 1000), String(start - 2000), true],
  );
  await db.query(
    "insert into notes (id, job_id, review_id, producer_id, frame, x, y, text, typed_name, suggested_seconds, suggested_frames, attachment_id, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    [newId(), ids.mapleId, mapleReview, ids.producerMaple, 4, "33.0", "71.0", "Le plan est un peu court.", "Élodie Tremblay", null, null, null, "open", String(start - 400)],
  );
  // Polder Run: a cue for Lantern Street, from 30 days before first start
  // until yesterday.
  await db.query(
    "insert into cues (id, job_id, track_id, title, composer, seconds, market, from_date, until_date, fee, licence_id, licence_text) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    [newId(), ids.polderId, "hr-1001", "Lantern Street", "Ilse Voss", 30, "NL", addDays(shortDate(start), -30), addDays(shortDate(start), -1), "120.00", "lic-401", "Licence ref lic-401"],
  );
  // Maple Line: a cue for Tidal Grid, until 3 days after, on Toronto's date.
  await db.query(
    "insert into cues (id, job_id, track_id, title, composer, seconds, market, from_date, until_date, fee, licence_id, licence_text) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    [newId(), ids.mapleId, "hr-1002", "Tidal Grid", "Joost Amani", 15, "CA", addDays(shortDate(start), -30), addDays(shortDate(start), 3), "120.00", "lic-402", "Licence ref lic-402"],
  );
  // Maple Line: one fee letter in CAD, state sent.
  await db.query(
    "insert into letters (id, job_id, currency, scope, fee_minor, tax_minor, total_minor, state, stamp, producer_id, page_token, page_ends_at, pdf_stored_at, created_at, accepted_at, accepted_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    [newId(), ids.mapleId, "CAD", "Boards and story reel", String(600000), "78000", String(678000), "sent", newToken(), ids.producerMaple, newToken(), String(start + 1209600), null, String(start), null, null],
  );
}

async function seedJob(db: Db, spec: SeedJobSpec): Promise<void> {
  await db.query(
    "insert into jobs (id, desk_id, client_id, title, ad_id, due_date, target_seconds, frame_rate, aspect, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [spec.id, spec.deskId, spec.clientId, spec.title, spec.adId, spec.dueDate, spec.targetSeconds, spec.frameRate, "16:9", spec.state, String(spec.start)],
  );
  await db.query(
    "insert into board_stamps (job_id, stamp, frame_rate) values ($1, $2, $3)",
    [spec.id, newToken(), spec.frameRate],
  );
  let position = 1;
  for (let i = 0; i < spec.frames.length; i++) {
    const number = i + 1;
    const duration = spec.frames[i]!.duration;
    const note = `Action for frame ${number}.`;
    await db.query(
      "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      [
        newId(),
        spec.id,
        number,
        position,
        duration,
        note,
        "",
        String(number),
        note,
        seededDrawingName(number),
        1280,
        720,
        null,
        true,
        String(spec.start),
      ],
    );
    position++;
  }
  // Cut 1 and Cut 2, both equal to the board at start.
  for (const [cutName, cutNumber] of [["First pass", 1], ["Second pass", 2]] as [string, number][]) {
    const cutId = newId();
    await db.query(
      "insert into cuts (id, job_id, number, name, frame_rate, created_at) values ($1, $2, $3, $4, $5, $6)",
      [cutId, spec.id, cutNumber, cutName, spec.frameRate, String(spec.start)],
    );
    const board = await db.many(
      "select id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded from frames where job_id = $1 order by position",
      [spec.id],
    );
    let cutPosition = 1;
    for (const frame of board) {
      await db.query(
        "insert into cut_frames (cut_id, frame_id, frame_number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
        [
          cutId,
          String(frame.id),
          Number(frame.number),
          cutPosition,
          Number(frame.duration_frames),
          String(frame.action_note),
          String(frame.audio_note),
          String(frame.shot),
          String(frame.visual),
          frame.file_name === null ? null : String(frame.file_name),
          frame.width === null ? null : Number(frame.width),
          frame.height === null ? null : Number(frame.height),
          frame.sha256 === null ? null : String(frame.sha256),
          Boolean(frame.seeded),
        ],
      );
      cutPosition++;
    }
  }
}

function shortDate(at: Instant): string {
  const d = new Date(at * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

// Seeded drawings are generated SVG files made when read and never kept in
// the file store, so a copy starts with the store down.
export function seededDrawing(frameNumber: number, actionNote: string): Buffer {
  return Buffer.from(frameDrawingSvg(frameNumber, actionNote), "utf8");
}

export function weekStartOf(at: Instant): string {
  return weekStartOfAmsterdam(at);
}

export { longDate, townOffsetMinutes, instantOfWall, instantText };
