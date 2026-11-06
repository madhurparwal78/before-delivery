import { createHash, randomUUID } from 'node:crypto';
import { COPY, say } from '../../domain/copy.js';
import { boardsHtml, editDecisionList, shotList } from '../../domain/delivery.js';
import type { DeliveryFrame } from '../../domain/delivery.js';
import { licenceHasEnded } from '../../domain/rules.js';
import {
  clockTimeInRoundedUp,
  isoDateIn,
  longDateFromIso,
  marketTown,
  toInstantText,
} from '../../domain/time.js';
import { config } from '../config.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { one, query } from '../infra/db.js';
import { PdfServiceDown, renderPdf } from '../infra/gotenberg.js';
import { deleteObject, objectExists, putObject, StoreDown, storeKeys } from '../infra/store.js';
import { takeHit } from '../rate.js';
import { FieldCollector, requireUuidParam } from '../validate.js';
import { readCues } from './cues.js';
import { readCutFrames, requireCut } from './cuts.js';
import type { CutFrameRow } from './cuts.js';
import { drawingBytes, readStored } from './drawings.js';
import { addEvent, isoDateText, requireJob, requireWritableJob, setJobState } from './support.js';
import type { JobRow } from './support.js';

const FILE_NAMES = {
  boards: 'boards.pdf',
  editDecisionList: 'edit-decision-list.edl',
  shotList: 'shot-list.csv',
} as const;

type PackageKind = keyof typeof FILE_NAMES;

const CONTENT_TYPES: Record<PackageKind, string> = {
  boards: 'application/pdf',
  editDecisionList: 'text/plain; charset=us-ascii',
  shotList: 'text/csv; charset=utf-8',
};

type PackageRow = {
  id: string;
  job_id: string;
  cut_number: number;
  state: string;
  created_at: Date;
};

type PackageFileRow = {
  package_id: string;
  kind: PackageKind;
  file_name: string;
  size: number;
  sha256: string;
};

async function packageJson(held: PackageRow): Promise<Record<string, unknown>> {
  const files = await query<PackageFileRow>(
    'select * from package_files where package_id = $1 order by kind asc',
    [held.id],
  );
  return {
    id: held.id,
    cut: held.cut_number,
    state: held.state,
    files: files.map((file) => ({
      kind: file.kind,
      fileName: file.file_name,
      size: file.size,
      sha256: file.sha256,
      url: `/api/packages/${held.id}/files/${file.kind}`,
    })),
    createdAt: toInstantText(held.created_at),
  };
}

function toDeliveryFrames(frames: readonly CutFrameRow[]): DeliveryFrame[] {
  return frames.map((frame) => ({
    number: frame.number,
    position: frame.position,
    durationFrames: frame.duration_frames,
    shot: frame.shot,
    visual: frame.visual,
    audioNote: frame.audio_note,
    actionNote: frame.action_note,
    fileName: frame.file_name ?? '',
  }));
}

/** A package is refused while a cue on the job has an ended licence. */
async function requireLicencesInForce(job: JobRow): Promise<void> {
  for (const cue of await readCues(job.id)) {
    const until = isoDateText(cue.until_date);
    if (licenceHasEnded(until, isoDateIn(new Date(), marketTown(cue.market)))) {
      throw refuse.state(say.licenceEndedForPackage(cue.title, longDateFromIso(until)));
    }
  }
}

export const packageRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/jobs/:id/packages',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const packages = await query<PackageRow>(
        'select * from packages where job_id = $1 order by created_at asc',
        [job.id],
      );
      return {
        status: 200,
        body: { packages: await Promise.all(packages.map(packageJson)) },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/packages',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const cutNumber = fields.wholeNumber(body, 'cut', 1, 10_000_000);
      fields.done();
      requireWritableJob(job);
      const cut = await requireCut(job.id, cutNumber);

      const stored = await one<PackageRow>(
        "select * from packages where job_id = $1 and cut_number = $2 and state = 'ready'",
        [job.id, cutNumber],
      );
      if (stored) return { status: 200, body: await packageJson(stored) };

      if (cut.signed_off_at === null) throw refuse.state(COPY.packageNotSignedOff);
      const frames = await readCutFrames(cut.id);
      const missing = frames.find((frame) => frame.drawing_kind === null);
      if (missing) throw refuse.state(say.frameNoDrawing(missing.number));
      await requireLicencesInForce(job);

      const delivery = toDeliveryFrames(frames);
      const drawings: string[] = [];
      for (const frame of frames) {
        const drawing = await drawingBytes(job, frame);
        drawings.push(
          drawing === null
            ? ''
            : `data:${drawing.contentType};base64,${drawing.bytes.toString('base64')}`,
        );
      }

      let boards: Buffer;
      try {
        boards = await renderPdf(
          boardsHtml(
            job.title,
            cut.frame_rate,
            delivery.map((frame, index) => ({ ...frame, drawing: drawings[index] ?? '' })),
          ),
        );
      } catch (error) {
        if (error instanceof PdfServiceDown) throw refuse.unavailable(COPY.pdfUnavailable);
        throw error;
      }

      const contents: Record<PackageKind, Buffer> = {
        boards,
        editDecisionList: Buffer.from(
          editDecisionList(job.title, cut.frame_rate, delivery),
          'ascii',
        ),
        shotList: Buffer.from(shotList(cut.frame_rate, delivery), 'utf8'),
      };

      const id = randomUUID();
      const written: string[] = [];
      try {
        for (const kind of Object.keys(FILE_NAMES) as PackageKind[]) {
          const key = storeKeys.packageFile(job.client_id, job.id, id, FILE_NAMES[kind]);
          await putObject(key, contents[kind], CONTENT_TYPES[kind]);
          written.push(key);
          if (!(await objectExists(key))) throw new StoreDown('object not confirmed');
        }
      } catch (error) {
        if (error instanceof StoreDown) {
          for (const key of written) await deleteObject(key).catch(() => undefined);
          throw refuse.unavailable(COPY.storeUnavailable);
        }
        throw error;
      }

      await query(
        `insert into packages (id, job_id, cut_number, state, created_at)
         values ($1,$2,$3,'ready',now())`,
        [id, job.id, cutNumber],
      );
      for (const kind of Object.keys(FILE_NAMES) as PackageKind[]) {
        await query(
          `insert into package_files (package_id, kind, file_name, size, sha256)
           values ($1,$2,$3,$4,$5)`,
          [
            id,
            kind,
            FILE_NAMES[kind],
            contents[kind].length,
            createHash('sha256').update(contents[kind]).digest('hex'),
          ],
        );
      }
      await setJobState(job, 'delivered');
      await addEvent(job.id, desk.name, 'packageMade', COPY.packageReady);
      const made = await one<PackageRow>('select * from packages where id = $1', [id]);
      return { status: 201, body: await packageJson(made as PackageRow) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/packages/:id/files/:kind',
    limit: async (_context, deskId) => {
      if (deskId === null) return;
      const verdict = await takeHit(
        `downloads:${deskId}`,
        5,
        config.timers.fileWindowSeconds,
      );
      if (!verdict.allowed) {
        throw refuse.rateLimited(
          say.tooManyDownloads(clockTimeInRoundedUp(verdict.retryAt, 'amsterdam')),
          (verdict.retryAt.getTime() - Date.now()) / 1000,
        );
      }
    },
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const kind = context.params['kind'] ?? '';
      if (!(kind in FILE_NAMES)) throw refuse.notFound();
      const held = await one<PackageRow & { client_id: string }>(
        `select p.*, j.client_id from packages p join jobs j on j.id = p.job_id
           join clients c on c.id = j.client_id
          where p.id = $1 and j.desk_id = $2 and c.state <> 'erased'`,
        [requireUuidParam(context.params['id'] ?? ''), desk.id],
      );
      if (!held) throw refuse.notFound();
      const file = await one<PackageFileRow>(
        'select * from package_files where package_id = $1 and kind = $2',
        [held.id, kind],
      );
      if (!file) throw refuse.notFound();
      const bytes = await readStored(
        storeKeys.packageFile(held.client_id, held.job_id, held.id, file.file_name),
      );
      return {
        status: 200,
        bytes,
        contentType: CONTENT_TYPES[kind as PackageKind],
        headers: { 'content-disposition': `attachment; filename="${file.file_name}"` },
      };
    },
  },
];
