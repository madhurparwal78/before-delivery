import { query } from './db.js';
import { config } from './config.js';
import { newId } from './errors.js';
import { hashPassword } from './password.js';
import { businessMs } from './clock.js';

/** Demo data for first start against an empty database. Never created again. */
export const seedDemoData = async (): Promise<void> => {
  const existing = await query(`SELECT 1 FROM members LIMIT 1`);
  if (existing.rows.length > 0) return;

  const startMs = Date.parse(config.startAt) || Date.now();
  const at = (offsetMs: number): Date => new Date(startMs + offsetMs);
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  const password = await hashPassword('plainwork-demo-2027');
  const members = [
    { key: 'ines', email: 'ines@demo.plainwork.example', handle: 'ines-okafor', name: 'Ines Okafor-Vale',
      headline: 'Site electrician at Calder Yard Builders', location: 'Milwaukee, WI', visibility: 'public',
      about: 'Licensed journeyman. Twelve years on commercial jobs.',
      experience: [
        { title: 'Site electrician', company: 'Calder Yard Builders', start: '2019-04', end: null },
        { title: 'Apprentice electrician', company: 'Lakeshore Power Co-op', start: '2014-09', end: '2019-03' },
      ],
      education: [{ school: 'Milwaukee Trades Institute', degree: 'Electrical apprenticeship', start: '2014-09', end: '2018-06' }],
      skills: ['Panel upgrades', 'Conduit bending', 'Blueprint reading'] },
    { key: 'theo', email: 'theo@demo.plainwork.example', handle: 'theo-marchetti', name: 'Theo Marchetti',
      headline: 'Kitchen lead at Brine and Barley', location: 'Madison, WI', visibility: 'connections',
      about: '', experience: [], education: [], skills: ['Line cooking', 'Food safety'] },
    { key: 'priya', email: 'priya@demo.plainwork.example', handle: 'priya-dunmore', name: 'Priya Dunmore',
      headline: 'Recruiter at Calder Yard Builders', location: 'Chicago, IL', visibility: 'public',
      about: '', experience: [], education: [], skills: ['Interviewing'] },
    { key: 'wen', email: 'wen@demo.plainwork.example', handle: 'wen-halloran', name: 'Wen Halloran',
      headline: 'Night-shift nurse', location: 'Rockford, IL', visibility: 'private',
      about: '', experience: [], education: [], skills: ['Patient triage'] },
  ];

  const idByKey = new Map<string, string>();
  for (const member of members) {
    const id = newId();
    idByKey.set(member.key, id);
    await query(
      `INSERT INTO members (id, email, handle, password_hash, name, headline, location, visibility, confirmed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
      [id, member.email, member.handle, password, member.name, member.headline, member.location,
       member.visibility, at(-30 * DAY)]);
    await query(`INSERT INTO profile_sections (member_id, about) VALUES ($1, $2)`, [id, member.about]);
    let pos = 0;
    for (const experience of member.experience) {
      await query(
        `INSERT INTO experience (id, member_id, title, company, start_month, end_month, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newId(), id, experience.title, experience.company, experience.start, experience.end, pos++]);
    }
    pos = 0;
    for (const education of member.education) {
      await query(
        `INSERT INTO education (id, member_id, school, degree, start_month, end_month, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newId(), id, education.school, education.degree, education.start, education.end, pos++]);
    }
    for (const skill of member.skills) {
      await query(`INSERT INTO skills (id, member_id, name) VALUES ($1, $2, $3)`, [newId(), id, skill]);
    }
  }

  const companyId = newId();
  await query(`INSERT INTO companies (id, handle, name, location, about) VALUES ($1, $2, $3, $4, $5)`,
    [companyId, 'calder-yard', 'Calder Yard Builders', 'Chicago, IL', 'Commercial construction across the Midwest.']);
  await query(`INSERT INTO company_admins (company_id, member_id) VALUES ($1, $2)`,
    [companyId, idByKey.get('priya')!]);
  await query(`INSERT INTO follows (follower_id, target_id, at) VALUES ($1, $2, $3)`,
    [idByKey.get('ines')!, companyId, at(-30 * DAY)]);

  const jobId = newId();
  await query(
    `INSERT INTO jobs (id, company_id, poster_id, title, location, workplace, posted_at, closes_at, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [jobId, companyId, idByKey.get('priya')!, 'Apprentice electrician', 'Chicago, IL', 'on-site',
     at(-2 * DAY), at(30 * DAY), 'Four-year paid apprenticeship. Every stage is listed below.']);

  // Connections at start - 30 days.
  for (const pair of [['ines', 'theo'], ['theo', 'priya'], ['priya', 'wen']]) {
    await query(
      `INSERT INTO connections (requester_id, addressee_id, state, requested_at, connected_at)
       VALUES ($1, $2, 'connected', $3, $3)`,
      [idByKey.get(pair[0])!, idByKey.get(pair[1])!, at(-30 * DAY)]);
  }

  const inesPostId = newId();
  await query(`INSERT INTO posts (id, author_id, text, created_at) VALUES ($1, $2, $3, $4)`,
    [inesPostId, idByKey.get('ines')!,
     'Finished a 200-amp panel swap before lunch. Label every circuit, every time. #PanelDay', at(-3 * HOUR)]);
  const priyaPostId = newId();
  await query(`INSERT INTO posts (id, author_id, text, created_at) VALUES ($1, $2, $3, $4)`,
    [priyaPostId, idByKey.get('priya')!,
     'We are hiring two apprentice electricians in Chicago. Every stage of our process is on the job page. #OpenRoles', at(-1 * DAY)]);
  await query(`INSERT INTO posts (id, author_id, text, created_at) VALUES ($1, $2, $3, $4)`,
    [newId(), idByKey.get('theo')!,
     'Prep list done, walk-in organised, and the new cook already knows where the tongs live.', at(-20 * 60_000)]);

  await query(`INSERT INTO reactions (post_id, member_id, type, at) VALUES ($1, $2, 'like', $3)`,
    [inesPostId, idByKey.get('theo')!, at(-2 * HOUR - 30 * 60_000)]);
  await query(`INSERT INTO reactions (post_id, member_id, type, at) VALUES ($1, $2, 'celebrate', $3)`,
    [inesPostId, idByKey.get('priya')!, at(-2 * HOUR)]);

  await query(`INSERT INTO comments (id, post_id, author_id, text, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [newId(), inesPostId, idByKey.get('theo')!, 'Labels save lives. Nice work.', at(-2 * HOUR)]);

  const panelSkill = await query(`SELECT id FROM skills WHERE member_id = $1 AND name = 'Panel upgrades'`,
    [idByKey.get('ines')!]);
  if (panelSkill.rows[0]) {
    await query(`INSERT INTO endorsements (owner_id, skill_id, endorser_id, at) VALUES ($1, $2, $3, $4)`,
      [idByKey.get('ines')!, panelSkill.rows[0].id, idByKey.get('theo')!, at(-1 * DAY)]);
  }

  const conversationId = newId();
  await query(`INSERT INTO conversations (id, created_at) VALUES ($1, $2)`, [conversationId, at(-1 * HOUR)]);
  await query(
    `INSERT INTO conversation_members (conversation_id, member_id, other_id) VALUES ($1, $2, $3), ($1, $3, $2)`,
    [conversationId, idByKey.get('theo')!, idByKey.get('ines')!]);
  await query(
    `INSERT INTO messages (id, conversation_id, sender_id, text, sent_at, read_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId(), conversationId, idByKey.get('theo')!, 'Are you on the Calder job next week?',
     at(-1 * HOUR), at(-50 * 60_000)]);

  void businessMs;
};
