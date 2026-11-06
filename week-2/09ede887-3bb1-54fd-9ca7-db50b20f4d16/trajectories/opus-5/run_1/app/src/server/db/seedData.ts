export interface SeedAccount {
  readonly email: string;
  readonly name: string;
  readonly role: 'attendee' | 'organiser';
}

export interface SeedStage {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
}

export interface SeedSpeakerRef {
  readonly name: string;
  readonly company: string;
}

export interface SeedSession {
  readonly id: string;
  readonly day: 1 | 2;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly title: string;
  readonly speakers: readonly SeedSpeakerRef[];
  readonly stage: string | null;
  readonly location: string | null;
  readonly format: string | null;
  readonly description: string;
  readonly capacity: number | null;
}

export const SEED_PASSWORD = 'deku-demo-pw-2026';

export const DAY_DATES: Readonly<Record<1 | 2, string>> = { 1: '2026-10-31', 2: '2026-11-01' };

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  { email: 'organiser@example.com', name: 'Outpost Organiser', role: 'organiser' },
  { email: 'attendee@example.com', name: 'Avery Stone', role: 'attendee' },
  { email: 'attendee2@example.com', name: 'Rowan Pike', role: 'attendee' },
  { email: 'attendee3@example.com', name: 'Quinn Hale', role: 'attendee' },
];

export const SEED_STAGES: readonly SeedStage[] = [
  {
    slug: 'summit-stage',
    name: 'Summit Stage',
    description: 'Keynotes and product reveals from industry leading voices',
  },
  {
    slug: 'signal-stage',
    name: 'Signal Stage',
    description: 'Demos, AMAs, and in-depth convos with ecosystem builders',
  },
  {
    slug: 'ai-builder-lab',
    name: 'AI Builder Lab',
    description: 'Hands-on AI workshops to learn, apply, and build something real',
  },
  {
    slug: 'the-arena',
    name: 'The Arena',
    description: 'Showcasing the latest DeFi developments and breakthroughs',
  },
];

export const SEED_SESSIONS: readonly SeedSession[] = [
  {
    id: 'd1-book-signing',
    day: 1,
    startLocal: '10:00',
    endLocal: '11:00',
    title: 'The Long Ledger: Book Signing',
    speakers: [{ name: 'Inès Okafor', company: 'Northgate Press' }],
    stage: null,
    location: 'Foyer',
    format: null,
    description: 'Bring your copy of The Long Ledger to the foyer table and have it signed by its author.',
    capacity: null,
  },
  {
    id: 'd1-doors-open',
    day: 1,
    startLocal: '11:00',
    endLocal: '11:00',
    title: 'Doors Open: Come Early to Get First Dibs on Doorbusters',
    speakers: [],
    stage: null,
    location: 'Lobby',
    format: null,
    description: 'The lobby opens and the first arrivals pick over the doorbuster table before anyone else.',
    capacity: null,
  },
  {
    id: 'd1-campus-to-protocol',
    day: 1,
    startLocal: '11:00',
    endLocal: '11:30',
    title: 'From Campus to Protocol: How to Get Hired in Open Finance',
    speakers: [
      { name: 'Mara Velasquez', company: 'Tidewater Labs' },
      { name: 'Theo Brandt', company: 'Student Ledger Society' },
    ],
    stage: 'ai-builder-lab',
    location: null,
    format: 'panel',
    description: 'A hiring panel on the portfolio, the first message and the interview that move a student into protocol work.',
    capacity: null,
  },
  {
    id: 'd1-clone-your-writing-voice',
    day: 1,
    startLocal: '11:30',
    endLocal: '12:00',
    title: 'Clone Your Writing Voice',
    speakers: [{ name: 'Ravi Menon', company: 'Keel Foundation' }],
    stage: 'ai-builder-lab',
    location: null,
    format: 'workshop',
    description: 'Fine-tune a small model on your own back catalogue until its drafts read the way you write.',
    capacity: 2,
  },
  {
    id: 'd1-chat-to-trade',
    day: 1,
    startLocal: '11:30',
    endLocal: '12:00',
    title: 'From Chat Prompt to Live Trade: An Agent in Real Time',
    speakers: [{ name: 'Lena Hart', company: 'Quayside' }],
    stage: 'signal-stage',
    location: null,
    format: 'demo-qa',
    description: 'A single typed instruction becomes a signed, settled trade while the room watches the ledger.',
    capacity: null,
  },
  {
    id: 'd1-hottest-takes',
    day: 1,
    startLocal: '11:30',
    endLocal: '12:45',
    title: 'Trading Competition: Battle of the Hottest Takes',
    speakers: [{ name: 'Sam Ortiz', company: 'Lantern' }],
    stage: 'the-arena',
    location: null,
    format: 'game',
    description: 'Defend your boldest market call with a live book and a leaderboard that updates every minute.',
    capacity: 40,
  },
  {
    id: 'd1-zero-to-funded',
    day: 1,
    startLocal: '12:00',
    endLocal: '12:30',
    title: 'From Zero to Funded Agent in Minutes',
    speakers: [{ name: 'Pavel Ivanov', company: 'Quayside' }],
    stage: 'ai-builder-lab',
    location: null,
    format: 'workshop',
    description: 'Stand up an agent, give it a spending limit and watch it pay its first invoice before the hour is out.',
    capacity: 30,
  },
  {
    id: 'd1-welcome',
    day: 1,
    startLocal: '13:00',
    endLocal: '13:05',
    title: 'Welcome to Keel Outpost 2026',
    speakers: [{ name: 'Jo Kimura', company: 'Keel Outpost' }],
    stage: 'summit-stage',
    location: null,
    format: null,
    description: 'Five minutes on what the next two days hold and how to get the most out of them.',
    capacity: null,
  },
  {
    id: 'd1-machine-economy',
    day: 1,
    startLocal: '13:05',
    endLocal: '13:30',
    title: "The Machine Economy Won't Wait",
    speakers: [{ name: 'Dana Whitfield', company: 'Tidewater Labs' }],
    stage: 'summit-stage',
    location: null,
    format: 'keynote',
    description: 'Software is already buying from software, and the rails we lay this year decide who it pays.',
    capacity: null,
  },
  {
    id: 'd1-who-writes-rules',
    day: 1,
    startLocal: '15:10',
    endLocal: '15:35',
    title: 'Who Writes the Rules?',
    speakers: [
      { name: 'Omar Haddad', company: 'Harbor Group' },
      { name: 'Clare Dunn', company: 'Tidewater Labs' },
    ],
    stage: 'summit-stage',
    location: null,
    format: 'fireside',
    description: 'A frank exchange on who sets the terms when autonomous payments outrun the rulebook.',
    capacity: null,
  },
  {
    id: 'd1-never-forgets',
    day: 1,
    startLocal: '15:30',
    endLocal: '16:30',
    title: 'Build an Agent That Never Forgets',
    speakers: [{ name: 'Mara Velasquez', company: 'Tidewater Labs' }],
    stage: 'ai-builder-lab',
    location: null,
    format: 'workshop',
    description: 'Give your agent a memory it can search, prune and explain, then prove it recalls last week.',
    capacity: 30,
  },
  {
    id: 'd1-happy-hour',
    day: 1,
    startLocal: '17:00',
    endLocal: '19:00',
    title: 'Community Happy Hour',
    speakers: [],
    stage: null,
    location: 'Community Avenue',
    format: null,
    description: 'Two hours on Community Avenue to find the people building the thing you need.',
    capacity: null,
  },
  {
    id: 'd2-agent-wallet',
    day: 2,
    startLocal: '11:00',
    endLocal: '11:30',
    title: 'Craft Your Own Agent Wallet',
    speakers: [{ name: 'Bea Arnaud', company: 'Café Arcfold' }],
    stage: 'ai-builder-lab',
    location: null,
    format: 'workshop',
    description: 'Build a wallet an agent can hold, with spending rules you can read and revoke in one line.',
    capacity: 30,
  },
  {
    id: 'd2-llm-showdown',
    day: 2,
    startLocal: '11:30',
    endLocal: '12:00',
    title: 'An LLM Showdown: Predict the Winner',
    speakers: [{ name: 'Dan Loh', company: 'Tidewater Labs' }],
    stage: 'the-arena',
    location: null,
    format: 'game',
    description: 'Four models take the same brief; back the one you think wins before the judges score it.',
    capacity: 40,
  },
  {
    id: 'd2-music-app',
    day: 2,
    startLocal: '11:30',
    endLocal: '12:30',
    title: 'Spin Up Your Own Music App',
    speakers: [{ name: 'Ben Li', company: 'Reedwork' }],
    stage: 'ai-builder-lab',
    location: null,
    format: 'workshop',
    description: 'Go from an empty folder to a playable, paying music app in a single sitting.',
    capacity: 30,
  },
  {
    id: 'd2-quality-factor',
    day: 2,
    startLocal: '12:00',
    endLocal: '12:25',
    title: 'Beyond Market Cap: A Quality Factor for Digital Assets',
    speakers: [{ name: 'Jamie Cole', company: 'Longview Research' }],
    stage: 'the-arena',
    location: null,
    format: 'keynote',
    description: 'A case for ranking digital assets by revenue, uptime and holder depth rather than headline size.',
    capacity: null,
  },
  {
    id: 'd2-future-intelligence',
    day: 2,
    startLocal: '13:05',
    endLocal: '13:25',
    title: 'The Future of Intelligence',
    speakers: [
      { name: 'Ruth Sato', company: 'Recurse' },
      { name: 'Kevin Bloom', company: 'Tidewater Labs' },
    ],
    stage: 'summit-stage',
    location: null,
    format: 'fireside',
    description: 'Twenty minutes on what gets cheaper, what gets scarce and what that does to the next decade.',
    capacity: null,
  },
  {
    id: 'd2-growing-ecosystem',
    day: 2,
    startLocal: '13:55',
    endLocal: '14:15',
    title: 'Growing the Builder Ecosystem',
    speakers: [
      { name: 'Ivo Lind', company: 'Comma Ventures' },
      { name: 'Jamal Khan', company: 'Keel Foundation' },
    ],
    stage: 'summit-stage',
    location: null,
    format: 'fireside',
    description: 'Where the grants, the mentors and the first customers actually come from, and how to reach them.',
    capacity: null,
  },
];

export const SEED_BIOS: Readonly<Record<string, string>> = {
  'mara-velasquez': 'Leads agent memory research at *Tidewater Labs*. Notes: <https://example.com/mara>',
  'ravi-menon': 'Writes **every day**; ships on Fridays.',
};

export const SEED_RESERVATION: { readonly email: string; readonly sessionId: string } = {
  email: 'attendee3@example.com',
  sessionId: 'd1-clone-your-writing-voice',
};
