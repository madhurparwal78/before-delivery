import type { LayoutContent, Role, SessionStatus } from '../../shared/protocol.js';
import { contentHash, sortContent } from '../domain/layout.js';
import { referenceContent } from '../domain/referenceLayout.js';
import { initialSessionState } from '../domain/session.js';
import { DEFAULT_STANDARDS } from '../domain/standards.js';
import { hashPassword } from '../services/auth.js';
import { pool, tx } from './pool.js';

const PASSWORD = 'gandyboard-demo-1';

interface SeedPerson {
  id: string;
  display_name: string;
  email: string;
  role: Role;
  workspaces: string[];
  walkthrough_done: boolean;
}

const PEOPLE: SeedPerson[] = [
  {
    id: 'u-founder',
    display_name: 'Founder Fishplate',
    email: 'founder@fishplate.example',
    role: 'founder',
    workspaces: ['tarn-valley', 'saltmarsh'],
    walkthrough_done: true,
  },
  {
    id: 'u-morgan',
    display_name: 'Morgan Tarn',
    email: 'manager@tarnvalley.example',
    role: 'manager',
    workspaces: ['tarn-valley'],
    walkthrough_done: true,
  },
  {
    id: 'u-robin',
    display_name: 'Robin Tarn',
    email: 'member@tarnvalley.example',
    role: 'member',
    workspaces: ['tarn-valley'],
    walkthrough_done: true,
  },
  {
    id: 'u-sam',
    display_name: 'Sam Tarn',
    email: 'member2@tarnvalley.example',
    role: 'member',
    workspaces: ['tarn-valley'],
    walkthrough_done: true,
  },
  {
    id: 'u-alex',
    display_name: 'Alex Tarn',
    email: 'operator@tarnvalley.example',
    role: 'operator',
    workspaces: ['tarn-valley'],
    walkthrough_done: true,
  },
  {
    id: 'u-jo',
    display_name: 'Jo Tarn',
    email: 'operator2@tarnvalley.example',
    role: 'operator',
    workspaces: ['tarn-valley'],
    walkthrough_done: true,
  },
  {
    id: 'u-riley',
    display_name: 'Riley Tarn',
    email: 'newmember@tarnvalley.example',
    role: 'member',
    workspaces: ['tarn-valley'],
    walkthrough_done: false,
  },
  {
    id: 'u-casey',
    display_name: 'Casey Marsh',
    email: 'manager@saltmarsh.example',
    role: 'manager',
    workspaces: ['saltmarsh'],
    walkthrough_done: true,
  },
  {
    id: 'u-dale',
    display_name: 'Dale Marsh',
    email: 'operator@saltmarsh.example',
    role: 'operator',
    workspaces: ['saltmarsh'],
    walkthrough_done: true,
  },
];

function withDepart(content: LayoutContent, entryId: string, departFastSeconds: number): LayoutContent {
  const copy = JSON.parse(JSON.stringify(content)) as LayoutContent;
  const entry = copy.timetable.entries.find((row) => row.id === entryId);
  if (entry) entry.depart_fast_seconds = departFastSeconds;
  return copy;
}

export async function seedIfEmpty(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(`select id from seed_state where id = 'v1'`);
  if (rows.length > 0) return;

  const passwordHash = await hashPassword(PASSWORD);

  await tx(async (client) => {
    for (const person of PEOPLE) {
      await client.query(
        `insert into users (id, email, display_name, password_hash, walkthrough_done)
         values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
        [person.id, person.email, person.display_name, passwordHash, person.walkthrough_done],
      );
    }

    for (const workspace of [
      { id: 'tarn-valley', name: 'Tarn Valley Model Railway Club' },
      { id: 'saltmarsh', name: 'Saltmarsh Modular Group' },
    ]) {
      await client.query(
        `insert into workspaces (id, name, standards) values ($1, $2, $3)
         on conflict (id) do nothing`,
        [workspace.id, workspace.name, JSON.stringify(DEFAULT_STANDARDS)],
      );
    }

    for (const person of PEOPLE) {
      const workspaces =
        person.role === 'founder' ? ['tarn-valley', 'saltmarsh'] : person.workspaces;
      for (const workspaceId of workspaces) {
        await client.query(
          `insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)
           on conflict (workspace_id, user_id) do nothing`,
          [workspaceId, person.id, person.role],
        );
      }
    }

    const tarnContent = sortContent(referenceContent(12));
    await client.query(
      `insert into layouts (id, workspace_id, name, content, module_revisions, revision)
       values ($1, $2, $3, $4, $5, 0)`,
      [
        'tarn-main',
        'tarn-valley',
        'Tarn Valley Main Line',
        JSON.stringify(tarnContent),
        JSON.stringify(
          Object.fromEntries(tarnContent.modules.map((module) => [module.id, 0])),
        ),
      ],
    );

    for (let number = 1; number <= 12; number += 1) {
      const content =
        number === 12
          ? tarnContent
          : sortContent(withDepart(referenceContent(number), 'tt-1', number * 60));
      await client.query(
        `insert into layout_versions
           (id, layout_id, number, state, canonical_hash, content, label, saved_by, restored_from)
         values ($1, $2, $3, 'Published', $4, $5, $6, 'Founder Fishplate', null)`,
        [
          `tarn-main-v${number}`,
          'tarn-main',
          number,
          contentHash(content),
          JSON.stringify(content),
          `Issue ${number}`,
        ],
      );
    }

    const saltmarshContent = sortContent(referenceContent(1));
    await client.query(
      `insert into layouts (id, workspace_id, name, content, module_revisions, revision)
       values ($1, $2, $3, $4, $5, 0)`,
      [
        'saltmarsh-branch',
        'saltmarsh',
        'Saltmarsh Branch',
        JSON.stringify(saltmarshContent),
        JSON.stringify(
          Object.fromEntries(saltmarshContent.modules.map((module) => [module.id, 0])),
        ),
      ],
    );
    await client.query(
      `insert into layout_versions
         (id, layout_id, number, state, canonical_hash, content, label, saved_by, restored_from)
       values ($1, $2, 1, 'Published', $3, $4, 'Issue 1', 'Founder Fishplate', null)`,
      ['saltmarsh-branch-v1', 'saltmarsh-branch', contentHash(saltmarshContent), JSON.stringify(saltmarshContent)],
    );

    const sessions: {
      id: string;
      workspaceId: string;
      layoutId: string;
      name: string;
      versionId: string;
      versionNumber: number;
      content: LayoutContent;
      status: SessionStatus;
    }[] = [
      {
        id: 'thursday-running',
        workspaceId: 'tarn-valley',
        layoutId: 'tarn-main',
        name: 'Thursday running',
        versionId: 'tarn-main-v12',
        versionNumber: 12,
        content: tarnContent,
        status: 'Scheduled',
      },
      {
        id: 'tarn-shakedown',
        workspaceId: 'tarn-valley',
        layoutId: 'tarn-main',
        name: 'Tarn shakedown',
        versionId: 'tarn-main-v12',
        versionNumber: 12,
        content: tarnContent,
        status: 'Running',
      },
      {
        id: 'saltmarsh-rehearsal',
        workspaceId: 'saltmarsh',
        layoutId: 'saltmarsh-branch',
        name: 'Saltmarsh rehearsal',
        versionId: 'saltmarsh-branch-v1',
        versionNumber: 1,
        content: saltmarshContent,
        status: 'Running',
      },
    ];

    for (const session of sessions) {
      const content = JSON.parse(JSON.stringify(session.content)) as LayoutContent;
      await client.query(
        `insert into sessions (id, workspace_id, layout_id, name, status, hold_reason, ratio,
             revision, control_revision, session_version, tick, layout_version_id,
             layout_version_number, timetable_version, state)
         values ($1, $2, $3, $4, $5, null, 6, 0, 0, 1, 0, $6, $7, $8, $9)`,
        [
          session.id,
          session.workspaceId,
          session.layoutId,
          session.name,
          session.status,
          session.versionId,
          session.versionNumber,
          content.timetable.version,
          JSON.stringify(initialSessionState(content)),
        ],
      );
    }

    await client.query(`insert into seed_state (id) values ('v1')`);
  });
}
