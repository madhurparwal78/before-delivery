/** Checks the delivery file formats against the brief's printed examples. */
const base = process.env.BASE ?? 'http://127.0.0.1:4173';
let cookie = '';
let failures = 0;

async function call(method, path, body) {
  const headers = {};
  if (cookie) headers['cookie'] = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response;
}

function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
}

await call('POST', '/api/sign-in', {
  email: 'noor@noorbakkerboards.example',
  password: 'desk-pass-2027',
});

const jobs = await (await call('GET', '/api/jobs')).json();
const harbour = jobs.jobs.find((job) => job.title === 'Harbour Light');
const maple = jobs.jobs.find((job) => job.title === 'Maple Line');

const made = await call('POST', `/api/jobs/${harbour.id}/packages`, { cut: 1 });
const held = await made.json();
console.log('package status', made.status, held.state ?? held.error?.message);

const edl = await (
  await call('GET', `/api/packages/${held.id}/files/editDecisionList`)
).text();
console.log('--- edit decision list, 29.97 ---');
console.log(JSON.stringify(edl.slice(0, 260)));
const lines = edl.split('\r\n');
check('title line', lines[0], 'TITLE: Harbour Light');
check('frame count mode', lines[1], 'FCM: DROP FRAME');
check('blank line', lines[2], '');
check(
  'first event',
  lines[3],
  '001  AX       V     C        00:00:00;00 00:00:02;15 01:00:00;00 01:00:02;15',
);
check('first clip name', lines[4], '* FROM CLIP NAME: frame-1.svg');
check('ends with CRLF', edl.endsWith('\r\n'), true);
check('ASCII only', /^[\x00-\x7f]*$/.test(edl), true);

const shots = await (await call('GET', `/api/packages/${held.id}/files/shotList`)).text();
console.log('--- shot list ---');
console.log(JSON.stringify(shots.slice(0, 220)));
check(
  'header',
  shots.split('\r\n')[0],
  '"position","frame","timecodeIn","seconds","shot","visual","audio","actionNote"',
);
check(
  'first row',
  shots.split('\r\n')[1],
  '"1","1","00:00:00;00","2.50","1","Action for frame 1.","","Action for frame 1."',
);

const boards = await call('GET', `/api/packages/${held.id}/files/boards`);
const pdf = Buffer.from(await boards.arrayBuffer());
check('pdf magic', pdf.subarray(0, 5).toString('ascii'), '%PDF-');
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log('boards pdf pages for twelve frames:', pages, `(${pdf.length} bytes)`);

const letter = await (await call('GET', `/api/jobs/${maple.id}/letter`)).json();
const letterPdf = await call('GET', `/api/letters/${letter.id}/pdf`);
const letterBytes = Buffer.from(await letterPdf.arrayBuffer());
check('letter pdf magic', letterBytes.subarray(0, 5).toString('ascii'), '%PDF-');
console.log('letter pdf bytes:', letterBytes.length);

console.log(failures === 0 ? '\nall ok' : `\n${failures} failures`);
