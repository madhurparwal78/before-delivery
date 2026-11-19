import { now } from '../clock.js';
import { config } from '../config.js';
import { maybeRow, transaction } from '../db.js';
import { applySeed, type SeedBody } from './seed.js';

/**
 * The demo members' shared sign-in password, which the brief publishes, held only as its salted scrypt hash. It is a
 * member account credential, not a setting or secret of any backing service; those all come from the environment.
 */
const DEMO_PASSWORD_HASH =
  '7b1e4c90a2d35f86c41d0e9a5b27f3d8:cd79d8e9e685626c758adad846368ce50d75cfb478d6981c71169822021cd61744e6d55844c56caf1f77f875960271ce56ba0054b14ffb4d47e0135bea7ea4dd';
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The published demo data, with times as offsets from the business clock's start. */
function demoSeed(start: Date): SeedBody {
  const at = (offsetMs: number): string => new Date(start.getTime() + offsetMs).toISOString();
  const demoUser = (key: string, name: string, handle: string, headline: string, location: string, visibility: 'public' | 'connections' | 'private', skills: string[]) => ({
    key,
    email: `${key}@demo.plainwork.example`,
    password_hash: DEMO_PASSWORD_HASH,
    name,
    handle,
    headline,
    location,
    visibility,
    skills,
  });
  return {
    users: [
      {
        ...demoUser('ines', 'Ines Okafor-Vale', 'ines-okafor', 'Site electrician at Calder Yard Builders', 'Milwaukee, WI', 'public', ['Panel upgrades', 'Conduit bending', 'Blueprint reading']),
        about: 'Licensed journeyman. Twelve years on commercial jobs.',
        experience: [
          { title: 'Site electrician', company: 'Calder Yard Builders', start: '2019-04', end: null },
          { title: 'Apprentice electrician', company: 'Lakeshore Power Co-op', start: '2014-09', end: '2019-03' },
        ],
        education: [{ school: 'Milwaukee Trades Institute', degree: 'Electrical apprenticeship', start: '2014-09', end: '2018-06' }],
      },
      demoUser('theo', 'Theo Marchetti', 'theo-marchetti', 'Kitchen lead at Brine and Barley', 'Madison, WI', 'connections', ['Line cooking', 'Food safety']),
      demoUser('priya', 'Priya Dunmore', 'priya-dunmore', 'Recruiter at Calder Yard Builders', 'Chicago, IL', 'public', ['Interviewing']),
      demoUser('wen', 'Wen Halloran', 'wen-halloran', 'Night-shift nurse', 'Rockford, IL', 'private', ['Patient triage']),
    ],
    connections: [
      { from: 'ines', to: 'theo', state: 'connected', at: at(-30 * DAY) },
      { from: 'theo', to: 'priya', state: 'connected', at: at(-30 * DAY) },
      { from: 'priya', to: 'wen', state: 'connected', at: at(-30 * DAY) },
    ],
    companies: [{ key: 'calder', name: 'Calder Yard Builders', handle: 'calder-yard', location: 'Chicago, IL', admins: ['priya'] }],
    follows: [{ follower: 'ines', target: 'calder', at: at(-7 * DAY) }],
    jobs: [
      {
        key: 'apprentice',
        company: 'calder',
        poster: 'priya',
        title: 'Apprentice electrician',
        location: 'Chicago, IL',
        workplace: 'on-site',
        posted_at: at(-2 * DAY),
        closes_at: at(30 * DAY),
        description: 'Four-year paid apprenticeship. Every stage is listed below.',
      },
    ],
    posts: [
      { key: 'ines-panel', author: 'ines', text: 'Finished a 200-amp panel swap before lunch. Label every circuit, every time. #PanelDay', at: at(-3 * HOUR) },
      { key: 'priya-hiring', author: 'priya', text: 'We are hiring two apprentice electricians in Chicago. Every stage of our process is on the job page. #OpenRoles', at: at(-1 * DAY) },
      { key: 'theo-prep', author: 'theo', text: 'Prep list done, walk-in organised, and the new cook already knows where the tongs live.', at: at(-20 * MINUTE) },
    ],
    reactions: [
      { post: 'ines-panel', user: 'theo', type: 'like', at: at(-2.5 * HOUR) },
      { post: 'ines-panel', user: 'priya', type: 'celebrate', at: at(-2 * HOUR) },
    ],
    comments: [{ key: 'theo-comment', post: 'ines-panel', author: 'theo', parent: null, text: 'Labels save lives. Nice work.', at: at(-2 * HOUR) }],
    endorsements: [{ endorser: 'theo', owner: 'ines', skill: 'Panel upgrades', at: at(-1 * DAY) }],
    messages: [{ from: 'theo', to: 'ines', text: 'Are you on the Calder job next week?', at: at(-1 * HOUR), read_at: at(-50 * MINUTE) }],
  };
}

/** On first start against an empty database, creates the demo members and their data. Never again. */
export async function seedDemoData(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(7040002)');
    if (await maybeRow(tx, 'SELECT 1 FROM members LIMIT 1')) return;
    await applySeed(demoSeed(config.startAt ?? now()), tx);
  });
}
