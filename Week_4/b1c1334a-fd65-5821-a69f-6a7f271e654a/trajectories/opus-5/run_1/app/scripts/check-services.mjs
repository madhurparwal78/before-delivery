import pg from 'pg';
import { api, check, done, signIn } from './apicheck.mjs';

const base = process.env.BASE ?? 'http://127.0.0.1:4173';
const mailpit = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

await fetch(`${mailpit}/api/v1/messages`, { method: 'DELETE' });

const mara = await signIn('mara');
await signIn('sam');

const docs = await api('mara', 'GET', '/api/documents');
const docId = docs.body.documents.find((d) => d.name === 'Harbour Lane Ops').id;
const read = await api('mara', 'GET', `/api/documents/${docId}`);
const ids = Object.fromEntries(read.body.tables.map((t) => [t.name, t.id]));
const table = async (who, name) =>
  (await api(who, 'GET', `/api/documents/${docId}/tables/${ids[name]}`)).body.table;
const cols = (t) => Object.fromEntries(t.columns.map((c) => [c.name, c.id]));

// An Editor types a customer name that begins with an equals sign.
const customers = await table('mara', 'Customers');
const cc = cols(customers);
const firstCustomer = customers.rows[0];
const renamed = await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Customers']}/rows/${firstCustomer.id}/cells/${cc['Name']}`,
  { value: '=Pell & Daughters Catering', revision: firstCustomer.cells[cc['Name']].revision },
);
check('grid keeps the value as typed', renamed.body.cell.display, '=Pell & Daughters Catering');

// DP-28: the export becomes ready only after storage confirms it.
const created = await api(
  'mara',
  'POST',
  `/api/documents/${docId}/tables/${ids['Customers']}/exports`,
);
check('export status', created.body.export.status, 'ready');
check('export file name', created.body.export.file_name, 'Customers.csv');
check('export author', created.body.export.created_by, mara.id);
check(
  'export revision',
  created.body.export.document_revision,
  (await api('mara', 'GET', `/api/documents/${docId}`)).body.document.revision,
);
check('export link', created.body.export.download_url, `/api/exports/${created.body.export.id}/download`);
check('export sha length', created.body.export.sha256.length, 64);

const download = await fetch(`${base}${created.body.export.download_url}`, {
  headers: { cookie: `tf_session=${/tf_session=([^;]*)/.exec('')?.[1] ?? ''}` },
});
check('download without session', download.status, 401);

const downloadWithSession = await api(
  'mara',
  'GET',
  `/api/exports/${created.body.export.id}/download`,
);
const csv = downloadWithSession.body;
check('csv content type', downloadWithSession.headers.get('content-type'), 'text/csv; charset=utf-8');
check(
  'csv disposition',
  downloadWithSession.headers.get('content-disposition'),
  `attachment; filename="Customers.csv"; filename*=UTF-8''Customers.csv`,
);
check('csv ends with CRLF', csv.endsWith('\r\n'), true);
check(
  'csv lines',
  csv.split('\r\n').slice(0, 3),
  [
    'Name,Region,Phone,Owner',
    `'=Pell & Daughters Catering,North,'+1-555-0142,dev@harbourlane.test`,
    'Greyfield Installers,South,555-0199,priya@harbourlane.test'.replace(
      'Greyfield Installers',
      '"Greyfield Installers, Ltd"',
    ),
  ],
);

// DP-72: later edits never change a stored export.
await api(
  'mara',
  'PUT',
  `/api/documents/${docId}/tables/${ids['Customers']}/rows/${firstCustomer.id}/cells/${cc['Name']}`,
  { value: 'Pell and Daughters', revision: renamed.body.cell.revision },
);
const second = await api('mara', 'GET', `/api/exports/${created.body.export.id}/download`);
check('same stored bytes', second.body, csv);
const record = await api('mara', 'GET', `/api/exports/${created.body.export.id}`);
check('record unchanged', JSON.stringify(record.body.export), JSON.stringify(created.body.export));

// A summary export matches the summary on screen.
const summaryExport = await api(
  'sam',
  'POST',
  `/api/documents/${docId}/tables/${ids['Orders by Region']}/exports`,
);
const summaryCsv = await api(
  'sam',
  'GET',
  `/api/exports/${summaryExport.body.export.id}/download`,
);
const summaryTable = await table('sam', 'Orders by Region');
const summaryLines = [
  summaryTable.columns.map((c) => c.name).join(','),
  ...summaryTable.rows.map((row) =>
    summaryTable.columns.map((c) => row.cells[c.id].display).join(','),
  ),
];
check('summary csv', summaryCsv.body, `${summaryLines.join('\r\n')}\r\n`);
check(
  'summary disposition',
  summaryCsv.headers.get('content-disposition'),
  `attachment; filename="Orders by Region.csv"; filename*=UTF-8''Orders%20by%20Region.csv`,
);
const otherPersons = await api('mara', 'GET', `/api/exports/${summaryExport.body.export.id}`);
check("another person's export", otherPersons.status, 404);
const list = await api('mara', 'GET', `/api/documents/${docId}/exports`);
check('own exports only', list.body.exports.length, 1);

// DP-72: a damaged stored file is refused.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query('update exports set sha256 = $2 where id = $1', [
  created.body.export.id,
  'f'.repeat(64),
]);
const corrupt = await api('mara', 'GET', `/api/exports/${created.body.export.id}/download`);
check('corrupt download', [corrupt.status, corrupt.body.error.code], [502, 'export_corrupt']);
const stillWorks = await api('mara', 'GET', `/api/documents/${docId}/tables/${ids['Customers']}`);
check('grid keeps working', stillWorks.status, 200);
await client.query('update exports set sha256 = $2 where id = $1', [
  created.body.export.id,
  created.body.export.sha256,
]);
const healed = await api('mara', 'GET', `/api/exports/${created.body.export.id}/download`);
check('download after repair', healed.status, 200);

// DP-25, DP-26: sharing and invites.
const unsafe = await api('mara', 'POST', `/api/documents/${docId}/shares`, {
  email: 'jonah@harbourlane.test\nbcc: snoop@elsewhere.test',
  role: 'viewer',
  row_scope: 'all',
});
check('unsafe email', [unsafe.status, unsafe.body.error.fields.email], [
  422,
  'Enter a valid email address.',
]);
const own = await api('mara', 'POST', `/api/documents/${docId}/shares`, {
  email: 'MARA@harbourlane.test',
  role: 'viewer',
  row_scope: 'all',
});
check('own document', own.body.error.fields.email, 'You already own this document.');
const share = await api('mara', 'POST', `/api/documents/${docId}/shares`, {
  email: 'Jonah@harbourlane.test',
  role: 'viewer',
  row_scope: 'all',
});
check('share status', [share.status, share.body.share.invite_status], [201, 'sent']);
check('share email lower-cased', share.body.share.email, 'jonah@harbourlane.test');
const strangerShare = await api('mara', 'POST', `/api/documents/${docId}/shares`, {
  email: 'stranger@example.test',
  role: 'editor',
  row_scope: 'own',
});
check('stranger share', [strangerShare.status, strangerShare.body.share.invite_status], [201, 'sent']);
const resend = await api(
  'mara',
  'POST',
  `/api/documents/${docId}/shares/${share.body.share.id}/resend`,
);
check('resend on sent', [resend.status, resend.body.error.code], [409, 'invite_already_sent']);

const messages = await (await fetch(`${mailpit}/api/v1/messages`)).json();
check('two invites', messages.messages.length, 2);
const jonahMessage = messages.messages.find((message) =>
  message.To.some((to) => to.Address === 'jonah@harbourlane.test'),
);
check('one recipient', jonahMessage.To.length, 1);
check('invite subject', jonahMessage.Subject, 'Mara Lindqvist shared Harbour Lane Ops with you');
check('invite from', jonahMessage.From.Address, 'invites@harbourlane.test');
const jonahBody = await (
  await fetch(`${mailpit}/api/v1/message/${jonahMessage.ID}`)
).json();
check(
  'invite body',
  jonahBody.Text.trim().split('\n').map((line) => line.trim()),
  [
    'Mara Lindqvist shared "Harbour Lane Ops" with you as Viewer.',
    `Open it here: ${process.env.APP_PUBLIC_URL ?? base}/d/${docId}`,
  ],
);

// DP-71: an accented document name is encoded and decodes exactly.
const accented = await api('mara', 'POST', '/api/documents', { name: 'Smörgås Café Ops' });
check('accented document', accented.status, 201);
await api('mara', 'POST', `/api/documents/${accented.body.document.id}/shares`, {
  email: 'jonah@harbourlane.test',
  role: 'editor',
  row_scope: 'all',
});
const accentedMessages = await (
  await fetch(`${mailpit}/api/v1/search?query=Smörgås`)
).json();
check('accented invite found', accentedMessages.messages.length, 1);
check(
  'accented subject decodes',
  accentedMessages.messages[0].Subject,
  'Mara Lindqvist shared Smörgås Café Ops with you',
);
const raw = await (
  await fetch(`${mailpit}/api/v1/message/${accentedMessages.messages[0].ID}/raw`)
).text();
const subjectLine = raw.split(/\r?\n/).find((line) => line.startsWith('Subject:'));
check('subject header is ascii', /^[\x20-\x7e]*$/.test(subjectLine), true);
check('subject header is encoded', subjectLine.includes('=?UTF-8?B?'), true);
check(
  'subject header lines are short',
  raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('Subject:') || line.startsWith(' =?UTF-8'))
    .every((line) => line.length <= 76),
  true,
);

// Long document name, so the subject folds over several encoded words.
const longName = `Smörgås ${'å'.repeat(60)} Ops`;
const longDoc = await api('mara', 'POST', '/api/documents', { name: longName });
await api('mara', 'POST', `/api/documents/${longDoc.body.document.id}/shares`, {
  email: 'jonah@harbourlane.test',
  role: 'viewer',
  row_scope: 'all',
});
const longMessages = await (
  await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent('å'.repeat(10))}`)
).json();
check(
  'folded subject decodes',
  longMessages.messages[0].Subject,
  `Mara Lindqvist shared ${longName} with you`,
);
const longRaw = await (
  await fetch(`${mailpit}/api/v1/message/${longMessages.messages[0].ID}/raw`)
).text();
check(
  'folded header lines are short and ascii',
  longRaw
    .split(/\r?\n/)
    .slice(0, 12)
    .filter((line) => line.startsWith('Subject:') || /^\s=\?UTF-8/.test(line))
    .every((line) => line.length <= 76 && /^[\x20-\x7e]*$/.test(line)),
  true,
);

const documentNameRefused = await api('mara', 'POST', '/api/documents', {
  name: 'Bad\nName',
});
check('document name with a line break', [
  documentNameRefused.status,
  documentNameRefused.body.error.fields.name,
], [422, 'Use 1 to 80 characters without line breaks or control characters.']);

await client.end();
done();
