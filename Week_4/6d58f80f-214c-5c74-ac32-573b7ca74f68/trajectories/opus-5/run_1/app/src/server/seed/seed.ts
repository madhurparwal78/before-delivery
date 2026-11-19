import { SETUP_LOCK, db, newId, withAdvisoryLock, withTransaction } from '../db.js';
import { SEED_PASSWORD } from '../config.js';
import { addDays, serverNow, today } from '../domain/clock.js';
import { rememberPerson } from '../domain/people.js';
import { upsertPerson } from '../services/directory.js';
import { putObject } from '../services/storage.js';
import { drawingSheetPdf } from './pdf.js';
import { blueprintPng } from './png.js';
import type { Person } from '../../shared/types.js';

interface SeedPerson {
  name: string;
  email: string;
  kind: 'staff' | 'partner';
  firm: string;
  staffRole: 'engineer' | 'controller' | 'admin' | null;
}

const PEOPLE: SeedPerson[] = [
  {
    name: 'Marisol Okafor',
    email: 'marisol.okafor@lintelworks.test',
    kind: 'staff',
    firm: 'Lintelworks',
    staffRole: 'engineer',
  },
  {
    name: 'Dev Halvorsen',
    email: 'dev.halvorsen@lintelworks.test',
    kind: 'staff',
    firm: 'Lintelworks',
    staffRole: 'engineer',
  },
  {
    name: 'Ines Whitcombe',
    email: 'ines.whitcombe@lintelworks.test',
    kind: 'staff',
    firm: 'Lintelworks',
    staffRole: 'controller',
  },
  {
    name: 'Tomas Achterberg',
    email: 'tomas.achterberg@lintelworks.test',
    kind: 'staff',
    firm: 'Lintelworks',
    staffRole: 'admin',
  },
  {
    name: 'Aiko Brandt',
    email: 'aiko.brandt@mesquiterow.test',
    kind: 'partner',
    firm: 'Mesquite Row Architects',
    staffRole: null,
  },
  {
    name: 'Callum Reyes-Tran',
    email: 'callum.reyes-tran@southerncross-review.test',
    kind: 'partner',
    firm: 'Southern Cross Review',
    staffRole: null,
  },
  {
    name: 'Rosa Tilden',
    email: 'rosa.tilden@pimasteel.test',
    kind: 'partner',
    firm: 'Pima Steel Erectors',
    staffRole: null,
  },
];

interface SeedFile {
  name: string;
  locked?: boolean;
}

interface SeedFolder {
  name: string;
  files: SeedFile[];
}

interface SeedProject {
  name: string;
  ownerEmail: string;
  folders: SeedFolder[];
}

const PROJECTS: SeedProject[] = [
  {
    name: '2614 Saguaro Medical Office',
    ownerEmail: 'marisol.okafor@lintelworks.test',
    folders: [
      {
        name: 'Calculations',
        files: [
          { name: 'Gravity calcs rev B.pdf' },
          { name: 'Lateral calcs rev A.pdf' },
          { name: 'Wind load summary.pdf' },
        ],
      },
      {
        name: 'Drawings',
        files: [
          { name: 'S-101 Foundation Plan.pdf', locked: true },
          { name: 'S-201 Second Floor Framing.pdf', locked: true },
          { name: 'S-202 Roof Framing.pdf' },
          { name: 'S-501 Typical Details.pdf' },
          { name: 'S-502 Moment Frame Details.pdf' },
        ],
      },
      {
        name: 'Site photos',
        files: [
          { name: 'Footing pour 2026-10-14.png' },
          { name: 'Rebar inspection 2026-10-21.png' },
        ],
      },
      {
        name: 'Issued',
        files: [{ name: 'IFC Set 2026-10-01.pdf' }, { name: 'Transmittal 2026-10-01.pdf' }],
      },
      { name: 'Reports', files: [] },
    ],
  },
  {
    name: '2631 Rillito Bridge Retrofit',
    ownerEmail: 'dev.halvorsen@lintelworks.test',
    folders: [
      { name: 'Calculations', files: [{ name: 'Pier capacity check.pdf' }] },
      { name: 'Drawings', files: [{ name: 'B-101 General Arrangement.pdf' }] },
      { name: 'Reports', files: [{ name: 'Condition survey 2026-09.pdf' }] },
    ],
  },
];

const BINNED_FILE = 'Old site photo 2026-08-30.png';

const bytesFor = (name: string, project: string): { body: Buffer; contentType: string } =>
  name.toLowerCase().endsWith('.png')
    ? { body: blueprintPng(name), contentType: 'image/png' }
    : { body: drawingSheetPdf(name, project), contentType: 'application/pdf' };

const isSeeded = async (): Promise<boolean> => {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::bigint AS n FROM folders');
  return (rows[0]?.n ?? 0) > 0;
};

/** Seeds an empty database once. All or nothing, and only one process at a time. */
export const seedIfEmpty = async (): Promise<boolean> =>
  withAdvisoryLock(SETUP_LOCK, async () => {
    if (await isSeeded()) return false;

    const people = new Map<string, Person>();
    for (const seed of PEOPLE) {
      const person = await upsertPerson({
        name: seed.name,
        email: seed.email,
        firm: seed.firm,
        kind: seed.kind,
        staffRole: seed.staffRole,
        password: SEED_PASSWORD,
      });
      people.set(seed.email, person);
      await rememberPerson(person);
    }

    const stored: {
      id: string;
      name: string;
      folderKey: string;
      size: number;
      contentType: string;
      locked: boolean;
      project: string;
      binned: boolean;
    }[] = [];

    for (const project of PROJECTS) {
      for (const folder of project.folders) {
        for (const file of folder.files) {
          const id = newId();
          const payload = bytesFor(file.name, project.name);
          await putObject(id, payload.body, payload.contentType);
          stored.push({
            id,
            name: file.name,
            folderKey: `${project.name}/${folder.name}`,
            size: payload.body.length,
            contentType: payload.contentType,
            locked: file.locked === true,
            project: project.name,
            binned: false,
          });
        }
      }
    }
    const binnedId = newId();
    const binnedPayload = bytesFor(BINNED_FILE, PROJECTS[0]?.name ?? '');
    await putObject(binnedId, binnedPayload.body, binnedPayload.contentType);
    stored.push({
      id: binnedId,
      name: BINNED_FILE,
      folderKey: '2614 Saguaro Medical Office/Site photos',
      size: binnedPayload.body.length,
      contentType: binnedPayload.contentType,
      locked: false,
      project: '2614 Saguaro Medical Office',
      binned: true,
    });

    const seedDate = today();
    const at = serverNow();

    await withTransaction(async (tx) => {
      const folderIds = new Map<string, string>();
      const owners = new Map<string, string>();
      for (const project of PROJECTS) {
        const ownerId = people.get(project.ownerEmail)?.id;
        if (ownerId === undefined) throw new Error('seed owner missing');
        const projectId = newId();
        folderIds.set(project.name, projectId);
        owners.set(project.name, ownerId);
        await tx.query(
          'INSERT INTO folders (id, name, parent_id, owner_id) VALUES ($1,$2,null,$3)',
          [projectId, project.name, ownerId],
        );
        await tx.query(
          'INSERT INTO ledger (id, at, actor_id, action, folder_id, detail) VALUES ($1,$2,$3,$4,$5,$6)',
          [
            newId(),
            at,
            ownerId,
            'folder_created',
            projectId,
            JSON.stringify({ folderName: project.name }),
          ],
        );
        for (const folder of project.folders) {
          const id = newId();
          folderIds.set(`${project.name}/${folder.name}`, id);
          await tx.query(
            'INSERT INTO folders (id, name, parent_id, owner_id) VALUES ($1,$2,$3,null)',
            [id, folder.name, projectId],
          );
          await tx.query(
            'INSERT INTO ledger (id, at, actor_id, action, folder_id, detail) VALUES ($1,$2,$3,$4,$5,$6)',
            [
              newId(),
              at,
              ownerId,
              'folder_created',
              id,
              JSON.stringify({ folderName: folder.name }),
            ],
          );
        }
      }

      for (const file of stored) {
        const folderId = folderIds.get(file.folderKey);
        const ownerId = owners.get(file.project);
        if (folderId === undefined || ownerId === undefined) throw new Error('seed folder missing');
        await tx.query(
          `INSERT INTO files (id, name, folder_id, size, content_type, modified_at, locked, state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            file.id,
            file.name,
            folderId,
            file.size,
            file.contentType,
            at,
            file.locked,
            file.binned ? 'binned' : 'live',
          ],
        );
        await tx.query(
          'INSERT INTO ledger (id, at, actor_id, action, file_id, folder_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [
            newId(),
            at,
            ownerId,
            'uploaded',
            file.id,
            folderId,
            JSON.stringify({ fileName: file.name, folderName: file.folderKey.split('/')[1] ?? '' }),
          ],
        );
        if (file.binned) {
          await tx.query(
            `INSERT INTO bin_items (file_id, from_folder_id, binned_date, retention_days, purge_date)
             VALUES ($1,$2,$3,$4,$5)`,
            [file.id, folderId, seedDate, 30, addDays(seedDate, 30)],
          );
          await tx.query(
            'INSERT INTO ledger (id, at, actor_id, action, file_id, folder_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [
              newId(),
              at,
              ownerId,
              'binned',
              file.id,
              folderId,
              JSON.stringify({ fileName: file.name }),
            ],
          );
        }
      }

      for (const policy of [
        { kind: 'bin_retention_days', days: 30 },
        { kind: 'partner_grant_days', days: 30 },
      ]) {
        await tx.query(
          'INSERT INTO policies (id, kind, days, effective_from) VALUES ($1,$2,$3,$4)',
          [newId(), policy.kind, policy.days, '2026-01-01'],
        );
      }

      const grantSeeds: {
        email: string;
        itemKey: string;
        role: 'viewer' | 'editor';
        days: number;
      }[] = [
        {
          email: 'aiko.brandt@mesquiterow.test',
          itemKey: '2614 Saguaro Medical Office/Drawings',
          role: 'editor',
          days: 30,
        },
        {
          email: 'callum.reyes-tran@southerncross-review.test',
          itemKey: '2614 Saguaro Medical Office',
          role: 'viewer',
          days: 60,
        },
        {
          email: 'callum.reyes-tran@southerncross-review.test',
          itemKey: '2614 Saguaro Medical Office/Calculations',
          role: 'editor',
          days: 14,
        },
        {
          email: 'rosa.tilden@pimasteel.test',
          itemKey: '2614 Saguaro Medical Office/Issued',
          role: 'viewer',
          days: 7,
        },
        {
          email: 'rosa.tilden@pimasteel.test',
          itemKey: '2631 Rillito Bridge Retrofit/Reports',
          role: 'editor',
          days: 3,
        },
      ];
      for (const grant of grantSeeds) {
        const personId = people.get(grant.email)?.id;
        const itemId = folderIds.get(grant.itemKey);
        if (personId === undefined || itemId === undefined) throw new Error('seed grant missing');
        const ownerId = owners.get(grant.itemKey.split('/')[0] ?? '');
        await tx.query(
          `INSERT INTO grants (id, item_type, item_id, person_id, role, end_date, status)
           VALUES ($1,'folder',$2,$3,$4,$5,'active')`,
          [newId(), itemId, personId, grant.role, addDays(seedDate, grant.days)],
        );
        await tx.query(
          'INSERT INTO ledger (id, at, actor_id, action, folder_id, detail) VALUES ($1,$2,$3,$4,$5,$6)',
          [
            newId(),
            at,
            ownerId ?? null,
            'shared',
            itemId,
            JSON.stringify({
              personName: people.get(grant.email)?.name ?? '',
              role: grant.role,
              endDate: addDays(seedDate, grant.days),
              folderName: grant.itemKey.split('/').pop() ?? '',
            }),
          ],
        );
      }

      const rillitoId = folderIds.get('2631 Rillito Bridge Retrofit');
      const dev = people.get('dev.halvorsen@lintelworks.test');
      const marisol = people.get('marisol.okafor@lintelworks.test');
      if (rillitoId === undefined || dev === undefined || marisol === undefined) {
        throw new Error('seed handover missing');
      }
      await tx.query(
        `INSERT INTO handovers (id, folder_id, from_id, to_id, offered_date, lapse_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,'offered')`,
        [newId(), rillitoId, dev.id, marisol.id, seedDate, addDays(seedDate, 7)],
      );
      await tx.query(
        'INSERT INTO ledger (id, at, actor_id, action, folder_id, detail) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          newId(),
          at,
          dev.id,
          'handover_offered',
          rillitoId,
          JSON.stringify({
            folderName: '2631 Rillito Bridge Retrofit',
            personName: marisol.name,
            endDate: addDays(seedDate, 7),
          }),
        ],
      );
    });
    return true;
  });

/** Keeps trying while a service the seed needs is unreachable. */
export const startSeedRetry = (): void => {
  const attempt = async (): Promise<void> => {
    try {
      if (await seedIfEmpty()) console.log('seed applied');
    } catch (error) {
      console.error('seed attempt failed, will retry', error instanceof Error ? error.message : error);
      setTimeout(() => void attempt(), 10_000).unref();
    }
  };
  void attempt();
};
