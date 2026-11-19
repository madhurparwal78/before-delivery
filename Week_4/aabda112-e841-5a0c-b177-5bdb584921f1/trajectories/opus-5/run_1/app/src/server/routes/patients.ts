import { Router } from 'express';
import { createHash } from 'node:crypto';
import { settings } from '../config';
import { clinicToday, isClinicDate, serverNow } from '../clock';
import { newId, one, query, transaction } from '../db';
import { AppError, invalid } from '../errors';
import { body, created, findInClinic, findPatient, ok, route } from '../http';
import { requireActor, requireCapability } from '../auth';
import { publish } from '../live';
import { parseMultipart, sniffContentType } from '../multipart';
import { exportObjectKey, fileObjectKey, getObject, putObject, putUpload } from '../storage';
import { historyPdf } from '../pdf';
import { clinicDdMonYyyy } from '../format';

export const patientRouter = Router();

const FILE_KINDS = ['xray', 'wound', 'lab', 'consent', 'profile'];

patientRouter.get(
  '/api/patients',
  route(async (request) => {
    const actor = await requireActor(request);
    const search = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const rows = await query<{
      id: string;
      name: string;
      species: string;
      client_name: string;
      weight_grams: number | null;
      photo_file_id: string | null;
      status: string | null;
    }>(
      `select p.id, p.name, p.species, c.name as client_name, p.weight_grams, p.photo_file_id,
              (select case
                        when exists (
                          select 1 from admissions a
                            join treatment_schedules s on s.admission_id = a.id
                            join treatment_doses d on d.schedule_id = s.id
                           where a.patient_id = p.id and d.status = 'open') then 'In ward'
                        when exists (
                          select 1 from appointments ap
                           where ap.patient_id = p.id and ap.status = 'in-consult') then 'In consult'
                        when exists (
                          select 1 from appointments ap
                           where ap.patient_id = p.id and ap.status = 'checked-in') then 'Waiting'
                        else null end) as status
         from patients p join clients c on c.id = p.client_id
        where p.clinic_id = $1
          and ($2 = '' or p.name ilike '%' || $2 || '%' or c.name ilike '%' || $2 || '%')
        order by p.name`,
      [actor.clinicId, search],
    );
    return ok({
      patients: rows.map((row) => ({
        id: row.id,
        name: row.name,
        species: row.species,
        clientName: row.client_name,
        weightGrams: row.weight_grams,
        photoFileId: row.photo_file_id,
        status: row.status,
      })),
    });
  }),
);

patientRouter.get(
  '/api/patients/:id',
  route(async (request) => {
    const actor = await requireActor(request);
    const patient = await findPatient(request.params.id, actor.clinicId);
    const client = await one<{ name: string; email: string }>(
      'select name, email from clients where id = $1',
      [patient.client_id],
    );
    const weights = await query<{ recorded_on: Date | string; grams: number }>(
      'select recorded_on, grams from patient_weights where patient_id = $1 order by recorded_on',
      [patient.id],
    );
    const vaccinations = await query<{
      id: string;
      vaccine: string;
      due_date: Date | string;
      reminder_status: string;
    }>(
      'select id, vaccine, due_date, reminder_status from vaccinations where patient_id = $1 order by due_date',
      [patient.id],
    );
    const history = await query<{
      id: string;
      start_at: Date;
      reason: string;
      vet_name: string;
      preview: string | null;
    }>(
      `select a.id, a.start_at, a.reason, u.name as vet_name,
              (select string_agg(p.text, ' ' order by p.n) from note_paragraphs p
                where p.appointment_id = a.id) as preview
         from appointments a join users u on u.id = a.vet_id
        where a.patient_id = $1 and a.status = 'completed'
        order by a.start_at desc`,
      [patient.id],
    );
    const status = await one<{ status: string | null }>(
      `select case
                when exists (select 1 from admissions a
                               join treatment_schedules s on s.admission_id = a.id
                               join treatment_doses d on d.schedule_id = s.id
                              where a.patient_id = $1 and d.status = 'open') then 'In ward'
                when exists (select 1 from appointments ap where ap.patient_id = $1 and ap.status = 'in-consult') then 'In consult'
                when exists (select 1 from appointments ap where ap.patient_id = $1 and ap.status = 'checked-in') then 'Waiting'
                else null end as status`,
      [patient.id],
    );
    return ok({
      id: patient.id,
      name: patient.name,
      species: patient.species,
      clientName: client?.name ?? '',
      clientEmail: client?.email ?? '',
      weightGrams: patient.weight_grams,
      photoFileId: patient.photo_file_id,
      status: status?.status ?? null,
      weights: weights.map((row) => ({
        recordedOn: typeof row.recorded_on === 'string' ? row.recorded_on : row.recorded_on.toISOString().slice(0, 10),
        grams: row.grams,
      })),
      vaccinations: vaccinations.map((row) => ({
        id: row.id,
        vaccine: row.vaccine,
        dueDate: typeof row.due_date === 'string' ? row.due_date : row.due_date.toISOString().slice(0, 10),
        reminder: row.reminder_status,
      })),
      history: history.map((row) => ({
        appointmentId: row.id,
        start: row.start_at.toISOString(),
        reason: row.reason,
        vetName: row.vet_name,
        notePreview: (row.preview ?? '').slice(0, 240),
      })),
    });
  }),
);

patientRouter.post(
  '/api/patients/:id/weights',
  route(async (request) => {
    const actor = await requireActor(request);
    const patient = await findPatient(request.params.id, actor.clinicId);
    requireCapability(actor, 'files.write');
    const input = body(request);
    const grams = input.grams;
    if (typeof grams !== 'number' || !Number.isInteger(grams) || grams < 1 || grams > 200_000) {
      throw invalid('grams');
    }
    await transaction(async (tx) => {
      await tx.query(
        'insert into patient_weights (id, patient_id, recorded_on, grams) values ($1,$2,$3,$4)',
        [newId(), patient.id, clinicToday(), grams],
      );
      await tx.query('update patients set weight_grams = $2 where id = $1', [patient.id, grams]);
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['patients'] });
    return created({ id: patient.id, grams });
  }),
);

patientRouter.post(
  '/api/patients/:id/vaccinations',
  route(async (request) => {
    const actor = await requireActor(request);
    const patient = await findPatient(request.params.id, actor.clinicId);
    requireCapability(actor, 'consult.manage');
    const input = body(request);
    const vaccine = typeof input.vaccine === 'string' ? input.vaccine.trim() : '';
    if (!vaccine) throw invalid('vaccine', 'missing');
    if (vaccine.length > 120) throw invalid('vaccine');
    if (!isClinicDate(input.dueDate)) {
      throw invalid('dueDate', input.dueDate === undefined ? 'missing' : 'invalid');
    }
    const duplicate = await one<{ id: string }>(
      'select id from vaccinations where patient_id = $1 and vaccine = $2 and due_date = $3',
      [patient.id, vaccine, input.dueDate],
    );
    if (duplicate) throw new AppError('duplicate_vaccination');
    const id = newId();
    await query(
      'insert into vaccinations (id, patient_id, vaccine, due_date) values ($1,$2,$3,$4)',
      [id, patient.id, vaccine, input.dueDate],
    );
    publish(actor.clinicId, { kind: 'changed', topics: ['patients'] });
    return created({ id, vaccine, dueDate: input.dueDate, reminder: 'Scheduled' });
  }),
);

patientRouter.get(
  '/api/patients/:id/files',
  route(async (request) => {
    const actor = await requireActor(request);
    const patient = await findPatient(request.params.id, actor.clinicId);
    const rows = await query<FileRow>(
      'select * from files where patient_id = $1 order by seq',
      [patient.id],
    );
    return ok({ files: rows.map(toApiFile) });
  }),
);

type FileRow = {
  id: string;
  patient_id: string;
  name: string;
  kind: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
};

function toApiFile(row: FileRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    url: `/api/files/${row.id}/content`,
  };
}

patientRouter.post(
  '/api/patients/:id/files',
  route(async (request) => {
    const actor = await requireActor(request);
    const patient = await findPatient(request.params.id, actor.clinicId);
    const parts = parseMultipart(
      Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
      request.header('content-type') ?? '',
    );
    const appointmentPart = parts.find((part) => part.name === 'appointmentId');
    const appointmentId = appointmentPart ? appointmentPart.data.toString('utf8').trim() : '';
    if (appointmentId) {
      await findInClinic('appointments', appointmentId, actor.clinicId, 'id');
    }
    requireCapability(actor, 'files.write');

    const kindPart = parts.find((part) => part.name === 'kind');
    const kind = kindPart ? kindPart.data.toString('utf8').trim() : '';
    if (!kind) throw invalid('kind', 'missing');
    if (!FILE_KINDS.includes(kind)) throw invalid('kind');
    const filePart = parts.find((part) => part.name === 'file');
    if (!filePart || filePart.filename === undefined) throw invalid('file', 'missing');
    const name = filePart.filename;
    if (name.length === 0 || Buffer.byteLength(name, 'utf8') > 255) throw invalid('file');
    const maxBytes = settings.uploadMaxMb * 1_048_576;
    if (filePart.data.length > maxBytes) throw new AppError('file_too_large', { field: 'file' });
    const contentType = sniffContentType(filePart.data);
    if (!contentType) throw new AppError('unsupported_type', { field: 'file' });

    const id = newId();
    const key = fileObjectKey(actor.clinicId, patient.id, id, name);
    await putUpload(key, filePart.data, contentType);
    const sha256 = createHash('sha256').update(filePart.data).digest('hex');
    await transaction(async (tx) => {
      await tx.query(
        `insert into files (id, clinic_id, patient_id, appointment_id, name, kind, content_type, size_bytes, sha256, object_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          actor.clinicId,
          patient.id,
          appointmentId || null,
          name,
          kind,
          contentType,
          filePart.data.length,
          sha256,
          key,
        ],
      );
      if (kind === 'profile') {
        await tx.query('update patients set photo_file_id = $2 where id = $1', [patient.id, id]);
      }
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['patients'] });
    return created({
      id,
      name,
      kind,
      contentType,
      sizeBytes: filePart.data.length,
      sha256,
      url: `/api/files/${id}/content`,
    });
  }),
);

patientRouter.get(
  '/api/files/:id/content',
  route(async (request, response) => {
    const actor = await requireActor(request);
    const file = await findInClinic<FileRow>('files', request.params.id, actor.clinicId);
    const bytes = await getObject(file.object_key);
    response.setHeader('Content-Type', file.content_type);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    response.status(200).end(bytes);
  }),
);

patientRouter.get(
  '/api/patients/:id/history.pdf',
  route(async (request, response) => {
    const actor = await requireActor(request);
    const patient = await findPatient(request.params.id, actor.clinicId);
    requireCapability(actor, 'consult.manage');
    const includeFiles = request.query.include === 'files';
    const history = await query<{ start_at: Date; reason: string; vet_name: string }>(
      `select a.start_at, a.reason, u.name as vet_name
         from appointments a join users u on u.id = a.vet_id
        where a.patient_id = $1 and a.status = 'completed'
        order by a.start_at desc`,
      [patient.id],
    );
    const files = includeFiles
      ? await query<{ name: string; kind: string }>(
          'select name, kind from files where patient_id = $1 order by seq',
          [patient.id],
        )
      : [];
    const bytes = await historyPdf({
      patientName: patient.name,
      entries: history.map(
        (row) => `${clinicDdMonYyyy(row.start_at.getTime())} ${row.reason} with ${row.vet_name}`,
      ),
      files: files.map((file) => `File: ${file.name} (${file.kind})`),
    });
    const key = exportObjectKey(
      actor.clinicId,
      'history',
      patient.id,
      Math.floor(serverNow() / 1000),
    );
    await putObject(key, bytes, 'application/pdf');
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${patient.name}-history.pdf`)}`,
    );
    response.status(200).end(bytes);
  }),
);

patientRouter.get(
  '/api/rooms',
  route(async (request) => {
    const actor = await requireActor(request);
    const rows = await query<{ id: string; name: string }>(
      'select id, name from rooms where clinic_id = $1 order by sort, name',
      [actor.clinicId],
    );
    return ok({ rooms: rows });
  }),
);

patientRouter.get(
  '/api/vets',
  route(async (request) => {
    const actor = await requireActor(request);
    const rows = await query<{ id: string; name: string }>(
      `select id, name from users where clinic_id = $1 and role = 'vet' and status = 'Active' order by name`,
      [actor.clinicId],
    );
    return ok({ vets: rows });
  }),
);

patientRouter.get(
  '/api/clients',
  route(async (request) => {
    const actor = await requireActor(request);
    const rows = await query<{
      id: string;
      name: string;
      patient_id: string | null;
      patient_name: string | null;
    }>(
      `select c.id, c.name, p.id as patient_id, p.name as patient_name
         from clients c left join patients p on p.client_id = c.id
        where c.clinic_id = $1 order by c.name, p.name`,
      [actor.clinicId],
    );
    const clients: { id: string; name: string; patients: { id: string; name: string }[] }[] = [];
    for (const row of rows) {
      let client = clients.find((candidate) => candidate.id === row.id);
      if (!client) {
        client = { id: row.id, name: row.name, patients: [] };
        clients.push(client);
      }
      if (row.patient_id && row.patient_name) {
        client.patients.push({ id: row.patient_id, name: row.patient_name });
      }
    }
    return ok({ clients });
  }),
);

