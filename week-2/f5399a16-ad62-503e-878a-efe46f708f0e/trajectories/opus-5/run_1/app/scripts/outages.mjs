/** Checks the outage copy of the MinIO-down and Gotenberg-down copies. */
async function signIn(base) {
  const response = await fetch(`${base}/api/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'noor@noorbakkerboards.example', password: 'desk-pass-2027' }),
  });
  return (response.headers.get('set-cookie') ?? '').split(';')[0];
}

function png(width, height) {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  return Buffer.concat([head, ihdr, Buffer.from('IEND'), Buffer.from(String(Math.random()))]);
}

const storage = 'http://127.0.0.1:4174';
const storageCookie = await signIn(storage);
const jobs = await (
  await fetch(`${storage}/api/jobs`, { headers: { cookie: storageCookie } })
).json();
const job = jobs.jobs.find((candidate) => candidate.title === 'Gulf Morning');

const form = new FormData();
form.append('file', new Blob([png(1280, 720)], { type: 'image/png' }), 'x.png');
const upload = await fetch(`${storage}/api/jobs/${job.id}/frames`, {
  method: 'POST',
  headers: { cookie: storageCookie },
  body: form,
});
console.log('MinIO down, upload:', upload.status, JSON.stringify(await upload.json()));

const render = 'http://127.0.0.1:4175';
const renderCookie = await signIn(render);
const renderJobs = await (
  await fetch(`${render}/api/jobs`, { headers: { cookie: renderCookie } })
).json();
const harbour = renderJobs.jobs.find((candidate) => candidate.title === 'Harbour Light');
const packaged = await fetch(`${render}/api/jobs/${harbour.id}/packages`, {
  method: 'POST',
  headers: { cookie: renderCookie, 'content-type': 'application/json' },
  body: JSON.stringify({ cut: 1 }),
});
console.log('Gotenberg down, package:', packaged.status, JSON.stringify(await packaged.json()));
