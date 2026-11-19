import { config } from './config';
import { query, transact } from './db';
import { newId } from './ids';
import { hashPassword } from './passwords';
import { hashtagsOf } from '../shared/richtext';

const DEMO_PASSWORD = 'plainwork-demo-2027';

function offset(seconds: number): Date {
  return new Date(Date.parse(config.startAt) + seconds * 1000);
}

const HOUR = 3600;
const DAY = 86400;
const MINUTE = 60;

type DemoMember = {
  key: string;
  name: string;
  handle: string;
  email: string;
  headline: string;
  location: string;
  visibility: string;
  skills: string[];
  about?: string;
};

const MEMBERS: DemoMember[] = [
  {
    key: 'ines',
    name: 'Ines Okafor-Vale',
    handle: 'ines-okafor',
    email: 'ines@demo.plainwork.example',
    headline: 'Site electrician at Calder Yard Builders',
    location: 'Milwaukee, WI',
    visibility: 'public',
    skills: ['Panel upgrades', 'Conduit bending', 'Blueprint reading'],
    about: 'Licensed journeyman. Twelve years on commercial jobs.',
  },
  {
    key: 'theo',
    name: 'Theo Marchetti',
    handle: 'theo-marchetti',
    email: 'theo@demo.plainwork.example',
    headline: 'Kitchen lead at Brine and Barley',
    location: 'Madison, WI',
    visibility: 'connections',
    skills: ['Line cooking', 'Food safety'],
  },
  {
    key: 'priya',
    name: 'Priya Dunmore',
    handle: 'priya-dunmore',
    email: 'priya@demo.plainwork.example',
    headline: 'Recruiter at Calder Yard Builders',
    location: 'Chicago, IL',
    visibility: 'public',
    skills: ['Interviewing'],
  },
  {
    key: 'wen',
    name: 'Wen Halloran',
    handle: 'wen-halloran',
    email: 'wen@demo.plainwork.example',
    headline: 'Night-shift nurse',
    location: 'Rockford, IL',
    visibility: 'private',
    skills: ['Patient triage'],
  },
];

/** Created once, on first start against an empty database. */
export async function seedDemoData(): Promise<void> {
  const marker = await query<{ key: string }>(`SELECT key FROM app_meta WHERE key = 'demo_seed'`);
  if (marker.length > 0) return;
  const anyMember = await query<{ id: string }>('SELECT id FROM members LIMIT 1');
  if (anyMember.length > 0) {
    await query(`INSERT INTO app_meta (key, value) VALUES ('demo_seed', 'skipped')`);
    return;
  }

  await transact(async (client) => {
    const ids: Record<string, string> = {};
    for (const member of MEMBERS) {
      const id = newId('mbr');
      ids[member.key] = id;
      await client.query(
        `INSERT INTO members (id, email, handle, password_hash, name, headline, location, about, visibility, confirmed, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
        [
          id,
          member.email,
          member.handle,
          hashPassword(DEMO_PASSWORD),
          member.name,
          member.headline,
          member.location,
          member.about ?? '',
          member.visibility,
          offset(-60 * DAY),
        ],
      );
      for (const skill of member.skills) {
        await client.query('INSERT INTO skills (id, member_id, name) VALUES ($1,$2,$3)', [
          newId('skl'),
          id,
          skill,
        ]);
      }
    }

    await client.query(
      `INSERT INTO experience (id, member_id, position, title, company, start_ym, end_ym)
       VALUES ($1,$2,0,'Site electrician','Calder Yard Builders','2019-04',NULL),
              ($3,$2,1,'Apprentice electrician','Lakeshore Power Co-op','2014-09','2019-03')`,
      [newId('exp'), ids.ines, newId('exp')],
    );
    await client.query(
      `INSERT INTO education (id, member_id, position, school, degree, start_ym, end_ym)
       VALUES ($1,$2,0,'Milwaukee Trades Institute','Electrical apprenticeship','2014-09','2018-06')`,
      [newId('edu'), ids.ines],
    );

    const connectedAt = offset(-30 * DAY);
    for (const [a, b] of [
      [ids.ines, ids.theo],
      [ids.theo, ids.priya],
      [ids.priya, ids.wen],
    ]) {
      const [low, high] = a < b ? [a, b] : [b, a];
      await client.query(
        'INSERT INTO connections (id, member_a, member_b, connected_at) VALUES ($1,$2,$3,$4)',
        [newId('con'), low, high, connectedAt],
      );
    }

    const companyId = newId('cmp');
    await client.query(
      'INSERT INTO companies (id, handle, name, location, about, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        companyId,
        'calder-yard',
        'Calder Yard Builders',
        'Chicago, IL',
        'Commercial builders working across the Midwest.',
        offset(-365 * DAY),
      ],
    );
    await client.query('INSERT INTO company_admins (company_id, member_id) VALUES ($1,$2)', [
      companyId,
      ids.priya,
    ]);
    await client.query('INSERT INTO follows (follower_id, target_id, created_at) VALUES ($1,$2,$3)', [
      ids.ines,
      companyId,
      offset(-30 * DAY),
    ]);

    await client.query(
      `INSERT INTO jobs (id, company_id, poster_id, title, location, workplace, description, posted_at, closes_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        newId('job'),
        companyId,
        ids.priya,
        'Apprentice electrician',
        'Chicago, IL',
        'on-site',
        'Four-year paid apprenticeship. Every stage is listed below.',
        offset(-2 * DAY),
        offset(30 * DAY),
      ],
    );

    const posts: { key: string; author: string; text: string; at: Date }[] = [
      {
        key: 'ines-post',
        author: ids.ines,
        text: 'Finished a 200-amp panel swap before lunch. Label every circuit, every time. #PanelDay',
        at: offset(-3 * HOUR),
      },
      {
        key: 'priya-post',
        author: ids.priya,
        text: 'We are hiring two apprentice electricians in Chicago. Every stage of our process is on the job page. #OpenRoles',
        at: offset(-1 * DAY),
      },
      {
        key: 'theo-post',
        author: ids.theo,
        text: 'Prep list done, walk-in organised, and the new cook already knows where the tongs live.',
        at: offset(-20 * MINUTE),
      },
    ];
    for (const post of posts) {
      const id = newId('pst');
      ids[post.key] = id;
      await client.query(
        'INSERT INTO posts (id, author_id, text, created_at) VALUES ($1,$2,$3,$4)',
        [id, post.author, post.text, post.at],
      );
      for (const tag of hashtagsOf(post.text)) {
        await client.query(
          'INSERT INTO post_hashtags (post_id, tag_lower, tag_raw) VALUES ($1,$2,$3)',
          [id, tag.toLowerCase(), tag],
        );
      }
    }

    await client.query(
      `INSERT INTO reactions (post_id, member_id, type, created_at)
       VALUES ($1,$2,'like',$3), ($1,$4,'celebrate',$5)`,
      [
        ids['ines-post'],
        ids.theo,
        offset(-2 * HOUR - 30 * MINUTE),
        ids.priya,
        offset(-2 * HOUR),
      ],
    );
    await client.query(
      'INSERT INTO comments (id, post_id, author_id, text, created_at) VALUES ($1,$2,$3,$4,$5)',
      [newId('cmt'), ids['ines-post'], ids.theo, 'Labels save lives. Nice work.', offset(-2 * HOUR)],
    );

    const panelSkill = await client.query<{ id: string }>(
      `SELECT id FROM skills WHERE member_id = $1 AND name = 'Panel upgrades'`,
      [ids.ines],
    );
    await client.query(
      'INSERT INTO endorsements (skill_id, endorser_id, created_at) VALUES ($1,$2,$3)',
      [panelSkill.rows[0].id, ids.theo, offset(-20 * DAY)],
    );

    const [low, high] = ids.ines < ids.theo ? [ids.ines, ids.theo] : [ids.theo, ids.ines];
    const conversationId = newId('cnv');
    await client.query(
      'INSERT INTO conversations (id, member_a, member_b, created_at) VALUES ($1,$2,$3,$4)',
      [conversationId, low, high, offset(-1 * HOUR)],
    );
    await client.query(
      'INSERT INTO messages (id, conversation_id, sender_id, text, sent_at, read_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        newId('msg'),
        conversationId,
        ids.theo,
        'Are you on the Calder job next week?',
        offset(-1 * HOUR),
        offset(-50 * MINUTE),
      ],
    );

    await client.query(`INSERT INTO app_meta (key, value) VALUES ('demo_seed', 'created')`);
  });
}
