import type { Db } from './db';
import { hashPassword } from './passwords';
import { fold } from './search';
import { venueInstant } from './venueTime';
import { AGENDA_ORDER } from './agenda';

// The published starting programme. Seeding runs inside the boot transaction, under the boot
// lock, and only on an empty database: the contest row is written last and marks it done.

const SEEDED_PASSWORD = 'deku-demo-pw-2026';

const ACCOUNTS: [email: string, name: string, role: 'attendee' | 'organiser'][] = [
  ['organiser@example.com', 'Outpost Organiser', 'organiser'],
  ['attendee@example.com', 'Avery Stone', 'attendee'],
  ['attendee2@example.com', 'Rowan Pike', 'attendee'],
  ['attendee3@example.com', 'Quinn Hale', 'attendee'],
];

const STAGES: [slug: string, name: string, description: string][] = [
  ['summit-stage', 'Summit Stage', 'Keynotes and product reveals from industry leading voices'],
  ['signal-stage', 'Signal Stage', 'Demos, AMAs, and in-depth convos with ecosystem builders'],
  ['ai-builder-lab', 'AI Builder Lab', 'Hands-on AI workshops to learn, apply, and build something real'],
  ['the-arena', 'The Arena', 'Showcasing the latest DeFi developments and breakthroughs'],
];

interface SeedSession {
  id: string;
  day: 1 | 2;
  start: string;
  end: string;
  title: string;
  speakers: [name: string, company: string][];
  stage: string | null;
  location: string | null;
  format: string | null;
  capacity: number | null;
  description: string;
}

const SESSIONS: SeedSession[] = [
  { id: 'd1-book-signing', day: 1, start: '10:00', end: '11:00', title: 'The Long Ledger: Book Signing',
    speakers: [['Inès Okafor', 'Northgate Press']], stage: null, location: 'Foyer', format: null, capacity: null,
    description: 'Meet the author of The Long Ledger and get your copy signed before the doors open.' },
  { id: 'd1-doors-open', day: 1, start: '11:00', end: '11:00', title: 'Doors Open: Come Early to Get First Dibs on Doorbusters',
    speakers: [], stage: null, location: 'Lobby', format: null, capacity: null,
    description: 'The hall opens its doors, so arrive early to pick up your badge and settle in.' },
  { id: 'd1-campus-to-protocol', day: 1, start: '11:00', end: '11:30', title: 'From Campus to Protocol: How to Get Hired in Open Finance',
    speakers: [['Mara Velasquez', 'Tidewater Labs'], ['Theo Brandt', 'Student Ledger Society']], stage: 'ai-builder-lab',
    location: null, format: 'panel', capacity: null,
    description: 'A hiring lead and a student organiser talk through the skills that land a first job in open finance.' },
  { id: 'd1-clone-your-writing-voice', day: 1, start: '11:30', end: '12:00', title: 'Clone Your Writing Voice',
    speakers: [['Ravi Menon', 'Keel Foundation']], stage: 'ai-builder-lab', location: null, format: 'workshop', capacity: 2,
    description: 'Train a small model on your own drafts and leave with an assistant that writes the way you do.' },
  { id: 'd1-chat-to-trade', day: 1, start: '11:30', end: '12:00', title: 'From Chat Prompt to Live Trade: An Agent in Real Time',
    speakers: [['Lena Hart', 'Quayside']], stage: 'signal-stage', location: null, format: 'demo-qa', capacity: null,
    description: 'Watch an agent turn a plain chat request into a settled trade, then put your questions to its builder.' },
  { id: 'd1-hottest-takes', day: 1, start: '11:30', end: '12:45', title: 'Trading Competition: Battle of the Hottest Takes',
    speakers: [['Sam Ortiz', 'Lantern']], stage: 'the-arena', location: null, format: 'game', capacity: 40,
    description: 'Back your boldest market call in a live paper-trading game scored in front of the room.' },
  { id: 'd1-zero-to-funded', day: 1, start: '12:00', end: '12:30', title: 'From Zero to Funded Agent in Minutes',
    speakers: [['Pavel Ivanov', 'Quayside']], stage: 'ai-builder-lab', location: null, format: 'workshop', capacity: 30,
    description: 'Spin up an agent, give it a wallet and fund it on a test network before the half hour is out.' },
  { id: 'd1-welcome', day: 1, start: '13:00', end: '13:05', title: 'Welcome to Keel Outpost 2026',
    speakers: [['Jo Kimura', 'Keel Outpost']], stage: 'summit-stage', location: null, format: null, capacity: null,
    description: 'A short welcome that sets out the two days ahead and where to find everything in the hall.' },
  { id: 'd1-machine-economy', day: 1, start: '13:05', end: '13:30', title: "The Machine Economy Won't Wait",
    speakers: [['Dana Whitfield', 'Tidewater Labs']], stage: 'summit-stage', location: null, format: 'keynote', capacity: null,
    description: 'Why software agents paying each other is closer than it looks, and what builders should ship first.' },
  { id: 'd1-who-writes-rules', day: 1, start: '15:10', end: '15:35', title: 'Who Writes the Rules?',
    speakers: [['Omar Haddad', 'Harbor Group'], ['Clare Dunn', 'Tidewater Labs']], stage: 'summit-stage', location: null,
    format: 'fireside', capacity: null,
    description: 'A policy adviser and a protocol engineer debate who should set the rules for autonomous payments.' },
  { id: 'd1-never-forgets', day: 1, start: '15:30', end: '16:30', title: 'Build an Agent That Never Forgets',
    speakers: [['Mara Velasquez', 'Tidewater Labs']], stage: 'ai-builder-lab', location: null, format: 'workshop', capacity: 30,
    description: 'Give an agent durable memory it can search, so it remembers every conversation it has had.' },
  { id: 'd1-happy-hour', day: 1, start: '17:00', end: '19:00', title: 'Community Happy Hour',
    speakers: [], stage: null, location: 'Community Avenue', format: null, capacity: null,
    description: 'Close the first day with drinks, music and the people you met in the workshops.' },
  { id: 'd2-agent-wallet', day: 2, start: '11:00', end: '11:30', title: 'Craft Your Own Agent Wallet',
    speakers: [['Bea Arnaud', 'Café Arcfold']], stage: 'ai-builder-lab', location: null, format: 'workshop', capacity: 30,
    description: 'Build a wallet an agent can hold, with spending limits you set and keys it never sees.' },
  { id: 'd2-llm-showdown', day: 2, start: '11:30', end: '12:00', title: 'An LLM Showdown: Predict the Winner',
    speakers: [['Dan Loh', 'Tidewater Labs']], stage: 'the-arena', location: null, format: 'game', capacity: 40,
    description: 'Language models face off on live trading puzzles while the room predicts which one comes out ahead.' },
  { id: 'd2-music-app', day: 2, start: '11:30', end: '12:30', title: 'Spin Up Your Own Music App',
    speakers: [['Ben Li', 'Reedwork']], stage: 'ai-builder-lab', location: null, format: 'workshop', capacity: 30,
    description: 'Ship a small music app that pays artists per play, from first commit to a working release.' },
  { id: 'd2-quality-factor', day: 2, start: '12:00', end: '12:25', title: 'Beyond Market Cap: A Quality Factor for Digital Assets',
    speakers: [['Jamie Cole', 'Longview Research']], stage: 'the-arena', location: null, format: 'keynote', capacity: null,
    description: 'A research lead proposes a quality score for digital assets that looks past their market size.' },
  { id: 'd2-future-intelligence', day: 2, start: '13:05', end: '13:25', title: 'The Future of Intelligence',
    speakers: [['Ruth Sato', 'Recurse'], ['Kevin Bloom', 'Tidewater Labs']], stage: 'summit-stage', location: null,
    format: 'fireside', capacity: null,
    description: 'Two researchers trade views on where machine intelligence goes next and what it will need.' },
  { id: 'd2-growing-ecosystem', day: 2, start: '13:55', end: '14:15', title: 'Growing the Builder Ecosystem',
    speakers: [['Ivo Lind', 'Comma Ventures'], ['Jamal Khan', 'Keel Foundation']], stage: 'summit-stage', location: null,
    format: 'fireside', capacity: null,
    description: 'An investor and a foundation lead discuss how to fund and support the next wave of builders.' },
];

const DAY_DATES = { 1: '2026-10-31', 2: '2026-11-01' } as const;

const SEEDED_BIOS: Record<string, string> = {
  'mara-velasquez': 'Leads agent memory research at *Tidewater Labs*. Notes: <https://example.com/mara>',
  'ravi-menon': 'Writes **every day**; ships on Fridays.',
};

// A speaker's slug: their folded name with every run of other characters replaced by "-".
function speakerSlug(name: string): string {
  let slug = '';
  for (const char of fold(name)) {
    const kept = (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
    if (kept) slug += char;
    else if (!slug.endsWith('-')) slug += '-';
  }
  return slug.replace(/^-|-$/g, '');
}

export async function seedDatabase(tx: Db): Promise<void> {
  const seeded = await tx.query('SELECT 1 FROM contest');
  if (seeded.rowCount !== 0) return;

  const hash = await hashPassword(SEEDED_PASSWORD);
  for (const [email, name, role] of ACCOUNTS) {
    await tx.query(
      'INSERT INTO accounts (name, email, role, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING',
      [name, email, role, hash],
    );
  }
  for (const [index, [slug, name, description]] of STAGES.entries()) {
    await tx.query(
      'INSERT INTO stages (slug, name, description, position) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
      [slug, name, description, index + 1],
    );
  }
  for (const s of SESSIONS) {
    const date = DAY_DATES[s.day];
    await tx.query(
      `INSERT INTO sessions (id, day, date, start_local, end_local, start_instant, end_instant, title, stage, location,
                             format, description, capacity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.day, date, s.start, s.end, venueInstant(date, s.start), venueInstant(date, s.end), s.title, s.stage,
        s.location, s.format, s.description, s.capacity],
    );
  }
  // Speakers in order of first appearance in the full ordered agenda.
  const ordered = await tx.query<{ id: string }>(`SELECT s.id FROM sessions s ORDER BY ${AGENDA_ORDER}`);
  const byId = new Map(SESSIONS.map((s) => [s.id, s]));
  let position = 0;
  for (const { id } of ordered.rows) {
    for (const [index, [name, company]] of (byId.get(id)?.speakers ?? []).entries()) {
      const slug = speakerSlug(name);
      const inserted = await tx.query(
        'INSERT INTO speakers (slug, name, company, bio, position) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING',
        [slug, name, company, SEEDED_BIOS[slug] ?? '', position + 1],
      );
      position += inserted.rowCount ?? 0;
      await tx.query(
        `INSERT INTO session_speakers (session_id, speaker_slug, position) VALUES ($1, $2, $3)
         ON CONFLICT (session_id, speaker_slug) DO NOTHING`,
        [id, slug, index + 1],
      );
    }
  }
  await tx.query(
    `INSERT INTO reservations (account_id, session_id)
     SELECT id, 'd1-clone-your-writing-voice' FROM accounts WHERE email = 'attendee3@example.com'
     ON CONFLICT (account_id, session_id) DO NOTHING`,
  );
  await tx.query('INSERT INTO contest (id) VALUES (true) ON CONFLICT (id) DO NOTHING');
}
