import { parseQuery, queryMatches } from '../src/shared/search.js';

interface Sess {
  id: string;
  title: string;
  speakers: string[];
  companies: string[];
}

const sessions: Sess[] = [
  { id: 'd1-book-signing', title: 'The Long Ledger: Book Signing', speakers: ['Inès Okafor'], companies: ['Northgate Press'] },
  { id: 'd1-doors-open', title: 'Doors Open: Come Early to Get First Dibs on Doorbusters', speakers: [], companies: [] },
  { id: 'd1-campus-to-protocol', title: 'From Campus to Protocol: How to Get Hired in Open Finance', speakers: ['Mara Velasquez', 'Theo Brandt'], companies: ['Tidewater Labs', 'Student Ledger Society'] },
  { id: 'd1-clone-your-writing-voice', title: 'Clone Your Writing Voice', speakers: ['Ravi Menon'], companies: ['Keel Foundation'] },
  { id: 'd1-chat-to-trade', title: 'From Chat Prompt to Live Trade: An Agent in Real Time', speakers: ['Lena Hart'], companies: ['Quayside'] },
  { id: 'd1-hottest-takes', title: 'Trading Competition: Battle of the Hottest Takes', speakers: ['Sam Ortiz'], companies: ['Lantern'] },
  { id: 'd1-zero-to-funded', title: 'From Zero to Funded Agent in Minutes', speakers: ['Pavel Ivanov'], companies: ['Quayside'] },
  { id: 'd1-welcome', title: 'Welcome to Keel Outpost 2026', speakers: ['Jo Kimura'], companies: ['Keel Outpost'] },
  { id: 'd1-machine-economy', title: "The Machine Economy Won't Wait", speakers: ['Dana Whitfield'], companies: ['Tidewater Labs'] },
  { id: 'd1-who-writes-rules', title: 'Who Writes the Rules?', speakers: ['Omar Haddad', 'Clare Dunn'], companies: ['Harbor Group', 'Tidewater Labs'] },
  { id: 'd1-never-forgets', title: 'Build an Agent That Never Forgets', speakers: ['Mara Velasquez'], companies: ['Tidewater Labs'] },
  { id: 'd1-happy-hour', title: 'Community Happy Hour', speakers: [], companies: [] },
  { id: 'd2-agent-wallet', title: 'Craft Your Own Agent Wallet', speakers: ['Bea Arnaud'], companies: ['Café Arcfold'] },
  { id: 'd2-llm-showdown', title: 'An LLM Showdown: Predict the Winner', speakers: ['Dan Loh'], companies: ['Tidewater Labs'] },
  { id: 'd2-music-app', title: 'Spin Up Your Own Music App', speakers: ['Ben Li'], companies: ['Reedwork'] },
  { id: 'd2-quality-factor', title: 'Beyond Market Cap: A Quality Factor for Digital Assets', speakers: ['Jamie Cole'], companies: ['Longview Research'] },
  { id: 'd2-future-intelligence', title: 'The Future of Intelligence', speakers: ['Ruth Sato', 'Kevin Bloom'], companies: ['Recurse', 'Tidewater Labs'] },
  { id: 'd2-growing-ecosystem', title: 'Growing the Builder Ecosystem', speakers: ['Ivo Lind', 'Jamal Khan'], companies: ['Comma Ventures', 'Keel Foundation'] },
];

function fields(s: Sess): string[] {
  return [s.title, ...s.speakers, ...s.companies];
}

function search(q: string): string[] {
  const query = parseQuery(q);
  return sessions.filter((s) => queryMatches(query, fields(s))).map((s) => s.id);
}

let fails = 0;
function check(q: string, want: string[]): void {
  const got = search(q);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(q));
  if (!ok) console.log('      got ', JSON.stringify(got), '\n      want', JSON.stringify(want));
}

// Well-formed queries.
check('agent', ['d1-chat-to-trade', 'd1-zero-to-funded', 'd1-never-forgets', 'd2-agent-wallet']);
check('agent -wallet', ['d1-chat-to-trade', 'd1-zero-to-funded', 'd1-never-forgets']);
check('"tidewater labs"', ['d1-campus-to-protocol', 'd1-machine-economy', 'd1-who-writes-rules', 'd1-never-forgets', 'd2-llm-showdown', 'd2-future-intelligence']);
check('tidewater AND agent', ['d1-never-forgets']);
check('quayside OR café', ['d1-chat-to-trade', 'd1-zero-to-funded', 'd2-agent-wallet']);
check('agent OR ledger AND keel', ['d1-chat-to-trade', 'd1-zero-to-funded', 'd1-never-forgets', 'd2-agent-wallet']);
check('(agent OR ledger) -tidewater', ['d1-book-signing', 'd1-chat-to-trade', 'd1-zero-to-funded', 'd2-agent-wallet']);
check('"won\'t wait"', ['d1-machine-economy']);
check('and', ['d1-campus-to-protocol']);
check('CAFE', ['d2-agent-wallet']);
check('cafe', ['d2-agent-wallet']);
check('Café', ['d2-agent-wallet']);
check('CAFÉ', ['d2-agent-wallet']);

// Malformed queries.
check('"tidewater labs', ['d1-campus-to-protocol', 'd1-machine-economy', 'd1-who-writes-rules', 'd1-never-forgets', 'd2-llm-showdown', 'd2-future-intelligence']);
check('(agent OR ledger', ['d1-book-signing', 'd1-campus-to-protocol', 'd1-chat-to-trade', 'd1-zero-to-funded', 'd1-never-forgets', 'd2-agent-wallet']);
check('agent OR', ['d1-chat-to-trade', 'd1-zero-to-funded', 'd1-never-forgets', 'd2-agent-wallet']);
check('OR agent', ['d1-chat-to-trade', 'd1-zero-to-funded', 'd1-never-forgets', 'd2-agent-wallet']);
check('agent)', ['d1-chat-to-trade', 'd1-zero-to-funded', 'd1-never-forgets', 'd2-agent-wallet']);
check('ledger AND OR keel', ['d1-book-signing', 'd1-campus-to-protocol', 'd1-clone-your-writing-voice', 'd1-welcome', 'd2-growing-ecosystem']);
check('-', sessions.map((s) => s.id));
check('agent () -""', ['d1-chat-to-trade', 'd1-zero-to-funded', 'd1-never-forgets', 'd2-agent-wallet']);

// Worst-case timing.
for (const [label, q] of [
  ['W1', '('.repeat(1000) + 'a' + ')'.repeat(1000)],
  ['W2', 'a OR '.repeat(400) + 'a'],
  ['W3', '"' + '\\'.repeat(2047)],
] as Array<[string, string]>) {
  const t0 = performance.now();
  const got = search(q);
  const ms = performance.now() - t0;
  const all = label === 'W3' ? got.length === 0 : got.length === sessions.length;
  const ok = ms < 500 && all;
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', label, `${ms.toFixed(1)}ms`, got.length, 'sessions');
}

// Repeated worst cases to check stability.
for (let round = 0; round < 3; round++) {
  const t0 = performance.now();
  search('('.repeat(1000) + 'a' + ')'.repeat(1000));
  search('a OR '.repeat(400) + 'a');
  search('"' + '\\'.repeat(2047));
  const ms = performance.now() - t0;
  if (ms > 1500) {
    fails++;
    console.log('FAIL worst-case round', round, ms);
  }
}

console.log(fails === 0 ? 'ALL OK' : fails + ' FAILURES');
