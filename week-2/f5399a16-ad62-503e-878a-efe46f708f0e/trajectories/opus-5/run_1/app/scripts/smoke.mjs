/** A quick walk through the desk's endpoints, run by hand while building. */
const base = process.env.BASE ?? 'http://127.0.0.1:4173';
let cookie = '';
let failures = 0;

async function call(method, path, body, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie && !options.noCookie) headers['cookie'] = cookie;
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${base}${path}`, { method, headers, body: payload });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 200);
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

function show(label, value) {
  console.log(`     ${label}: ${JSON.stringify(value)?.slice(0, 400)}`);
}

check('health', (await call('GET', '/api/health')).body, { status: 'ok' });
check('session with no cookie', (await call('GET', '/api/session')).status, 401);
check(
  'no cookie code',
  (await call('GET', '/api/session')).body.error.code,
  'notSignedIn',
);
check(
  'wrong password',
  (await call('POST', '/api/sign-in', {
    email: 'noor@noorbakkerboards.example',
    password: 'nope',
  })).status,
  401,
);
const signIn = await call('POST', '/api/sign-in', {
  email: 'noor@noorbakkerboards.example',
  password: 'desk-pass-2027',
});
check('sign in', signIn.status, 200);
show('desk', signIn.body);
check('session', (await call('GET', '/api/session')).status, 200);

const clients = await call('GET', '/api/clients');
check('clients total', clients.body.total, 4);
show('client names', clients.body.clients.map((c) => c.name));

const jobs = await call('GET', '/api/jobs');
check('jobs total', jobs.body.total, 4);
show(
  'jobs',
  jobs.body.jobs.map((job) => `${job.title} ${job.frameRate} ${job.state} ${job.dueDate}`),
);

const harbour = jobs.body.jobs.find((job) => job.title === 'Harbour Light');
const polder = jobs.body.jobs.find((job) => job.title === 'Polder Run');
const maple = jobs.body.jobs.find((job) => job.title === 'Maple Line');
const gulf = jobs.body.jobs.find((job) => job.title === 'Gulf Morning');

for (const [job, wanted] of [
  [harbour, 'exact'],
  [polder, 'exact'],
  [maple, 'exact'],
  [gulf, '6 frames under'],
]) {
  const board = await call('GET', `/api/jobs/${job.id}/board`);
  check(`${job.title} targetText`, board.body.targetText, wanted);
  check(`${job.title} frames`, board.body.frames.length, 12);
}

const board = (await call('GET', `/api/jobs/${polder.id}/board`)).body;
show('polder seconds', board.secondsText);
check('polder total', board.totalFrames, 750);

const drawing = await call('GET', `/api/jobs/${polder.id}/frames/3/drawing`);
check('drawing type', drawing.headers.get('content-type'), 'image/svg+xml');

const cuts = await call('GET', `/api/jobs/${harbour.id}/cuts`);
check('harbour cuts', cuts.body.cuts.length, 2);
check('cut 1 signed by', cuts.body.cuts[0].signedOffBy, 'Marcus Hale');

const notes = await call('GET', `/api/jobs/${harbour.id}/notes`);
check('harbour notes', notes.body.total, 2);
show('note', notes.body.notes[0]);

const cues = await call('GET', `/api/jobs/${polder.id}/cues`);
show('polder cue', cues.body.cues[0]);

const callList = await call('GET', '/api/calls');
check('seeded calls', callList.body.calls.length, 2);
show('call text', callList.body.calls.map((entry) => entry.text));

const today = await call('GET', '/api/today');
show('today', today.body);

const letter = await call('GET', `/api/jobs/${maple.id}/letter`);
show('letter', {
  fee: letter.body.feeText,
  tax: letter.body.taxText,
  total: letter.body.totalText,
  milestones: letter.body.milestones.map((m) => `${m.amountText}/${m.taxText}`),
});

const search = await call('GET', '/api/search?q=zoe%20orsted');
check('folded search', search.body.producers.length, 1);
check('search total', search.body.total, 1);

const history = await call('GET', `/api/jobs/${polder.id}/history`);
check('history empty on a fresh copy', history.body.events.length, 0);
const wrongMethod = await call('POST', `/api/jobs/${polder.id}/history`);
check('history 405', wrongMethod.status, 405);
check('history allow', wrongMethod.headers.get('allow'), 'GET, OPTIONS');

const foreign = await call('POST', '/api/clients', { name: 'X', place: 'ontario' }, {
  headers: { origin: 'http://evil.test' },
});
check('foreign origin', foreign.status, 403);

const madeClient = await call('POST', '/api/clients', {
  name: 'Lantern Row Films',
  place: 'ontario',
});
check('client made', madeClient.status, 201);
const clientId = madeClient.body.id;
const madeProducer = await call('POST', `/api/clients/${clientId}/producers`, {
  name: 'Ana Reis',
  email: 'ana.reis@example.test',
  town: 'toronto',
  language: 'fr',
});
check('producer made', madeProducer.status, 201);

const madeJob = await call('POST', '/api/jobs', {
  clientId,
  title: 'Night Ferry',
  adId: 'NOOR1234567H',
  dueDate: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
  targetSeconds: 30,
  frameRate: '25',
  aspect: '16:9',
});
check('job made', madeJob.status, 201);
const jobId = madeJob.body.id;

check(
  'bad ad id ending',
  (await call('POST', '/api/jobs', {
    clientId,
    title: 'X',
    adId: 'NOOR1234567X',
    dueDate: '2027-03-15',
    targetSeconds: 30,
    frameRate: '25',
    aspect: '16:9',
  })).body.error.fields.adId,
  'That Ad-ID should end in H or D.',
);
check(
  'bad ad id shape',
  (await call('POST', '/api/jobs', {
    clientId,
    title: 'X',
    adId: 'NO1234567H',
    dueDate: '2027-03-15',
    targetSeconds: 30,
    frameRate: '25',
    aspect: '16:9',
  })).body.error.fields.adId,
  'An Ad-ID has four letters, then seven letters or digits, then H or D.',
);

// Script: a byte order mark and CRLF.
const script = '\uFEFF"shot","visual","audio","seconds"\r\n"1A","Ferry, at dawn","Gulls","1.5"\r\n"1A","again","","1"\r\n"2B","","","x"\r\n"3C","Harbour wall","","2"\r\n';
const previewForm = new FormData();
previewForm.append('file', new Blob([script], { type: 'text/csv' }), 'script.csv');
const preview = await call('POST', `/api/jobs/${jobId}/script/preview`, previewForm);
check('preview status', preview.status, 200);
show('preview rows', preview.body.rows);

const saveForm = new FormData();
saveForm.append('file', new Blob([script], { type: 'text/csv' }), 'script.csv');
const saved = await call('POST', `/api/jobs/${jobId}/script`, saveForm);
show('script save', {
  created: saved.body.created,
  updated: saved.body.updated,
  unchanged: saved.body.unchanged,
  refused: saved.body.refused,
});
const saveAgain = new FormData();
saveAgain.append('file', new Blob([script], { type: 'text/csv' }), 'script.csv');
const twice = await call('POST', `/api/jobs/${jobId}/script`, saveAgain);
check('second save changes nothing', [twice.body.created, twice.body.updated], [0, 0]);

const afterScript = (await call('GET', `/api/jobs/${jobId}/board`)).body;
show(
  'frames after script',
  afterScript.frames.map((f) => `${f.number}:${f.shot}:${f.durationFrames}:${f.actionNote}`),
);

// Upload a PNG frame.
function pngBytes(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  return Buffer.concat([signature, ihdr, Buffer.from('IEND')]);
}

const good = new FormData();
good.append('file', new Blob([pngBytes(1280, 720)], { type: 'image/png' }), 'ferry-dawn.png');
const upload = await call('POST', `/api/jobs/${jobId}/frames`, good);
check('upload', upload.status, 201);
show('uploaded frame', upload.body.frame);

const again = new FormData();
again.append('file', new Blob([pngBytes(1280, 720)], { type: 'image/png' }), 'again.png');
check('repeat refused', (await call('POST', `/api/jobs/${jobId}/frames`, again)).body.error.message,
  `Already on this board as frame ${upload.body.frame.number}.`);

const wrongAspect = new FormData();
wrongAspect.append('file', new Blob([pngBytes(800, 800)], { type: 'image/png' }), 'square.png');
check('aspect refused', (await call('POST', `/api/jobs/${jobId}/frames`, wrongAspect)).body.error.message,
  'This frame is 800 x 800. This job is 16:9.');

const notImage = new FormData();
notImage.append('file', new Blob([Buffer.from('hello')], { type: 'image/png' }), 'x.png');
check('not an image', (await call('POST', `/api/jobs/${jobId}/frames`, notImage)).body.error.message,
  'This file is not a PNG or JPEG.');

const big = new FormData();
big.append('file', new Blob([Buffer.alloc(8_000_001)], { type: 'image/png' }), 'big.png');
const bigAnswer = await call('POST', `/api/jobs/${jobId}/frames`, big, { noCookie: true });
check('over the file limit with no session', bigAnswer.status, 413);
check('over the file limit copy', bigAnswer.body.error.message, 'This file is over 8,000,000 bytes.');

// More frames, so the board has something to move.
for (const size of [[1920, 1080], [640, 360]]) {
  const form = new FormData();
  form.append('file', new Blob([pngBytes(size[0], size[1])], { type: 'image/png' }), `frame-${size[0]}.png`);
  check(`upload ${size[0]}`, (await call('POST', `/api/jobs/${jobId}/frames`, form)).status, 201);
}

// Board moves and the undo window.
let stamp = (await call('GET', `/api/jobs/${jobId}/board`)).body.stamp;
const moved = await call('POST', `/api/jobs/${jobId}/frames/3/move`, { position: 1, stamp });
check('move', moved.status, 200);
check('moved to position 1', moved.body.frames[0].number, 3);
check('stale move', (await call('POST', `/api/jobs/${jobId}/frames/3/move`, { position: 2, stamp })).status, 412);

stamp = moved.body.stamp;
const removal = await call('POST', `/api/jobs/${jobId}/removals`, { frame: 3, stamp });
check('removal', removal.status, 201);
show('removal', removal.body);
const afterRemoval = (await call('GET', `/api/jobs/${jobId}/board`)).body;
check('frame gone from the board', afterRemoval.frames.some((f) => f.number === 3), false);
const undo = await call('POST', `/api/jobs/${jobId}/removals/3/undo`);
check('undo', undo.status, 200);
check('back in place', undo.body.frames[0].number, 3);

// Lines.
stamp = undo.body.stamp;
const line = await call('POST', `/api/jobs/${jobId}/lines`, {
  frame: 1,
  market: 'nl',
  text: 'Vanaf vandaag in de winkel',
  x: 10,
  y: 70,
  width: 60,
  height: 10,
  clips: 1,
});
show('line', line.status === 201 ? line.body : line.body.error);
const outside = await call('POST', `/api/jobs/${jobId}/lines`, {
  frame: 1,
  market: 'nl',
  text: 'Kort',
  x: 1.5,
  y: 70,
  width: 60,
  height: 10,
  clips: 1,
});
check('safe area copy', outside.body.error.message, 'This line runs outside the safe area by 3.5%.');

// Cues.
const trackSearch = await call('GET', '/api/cues/search?q=lantern');
show('library search', trackSearch.body); check('library search', trackSearch.body.tracks?.length, 3);
const cue = await call('POST', `/api/jobs/${jobId}/cues`, {
  trackId: 'hr-1001',
  title: 'Lantern Street',
  composer: 'Ilse Voss',
  seconds: 30,
  market: 'NL',
  from: new Date().toISOString().slice(0, 10),
  until: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
  fee: '9999.00',
});
check('cue made', cue.status, 201);
check('fee from the library', cue.body.fee, '120.00');
show('licence text', cue.body.licenceText);

// Cuts, renders and compare.
const cut1 = await call('POST', `/api/jobs/${jobId}/cuts`, { name: 'First pass' });
check('cut 1', cut1.body.number, 1);
stamp = (await call('GET', `/api/jobs/${jobId}/board`)).body.stamp;
await call('PATCH', `/api/jobs/${jobId}/frames/1`, { durationFrames: 50, stamp });
const cut2 = await call('POST', `/api/jobs/${jobId}/cuts`, { name: 'Second pass' });
check('cut 2', cut2.body.number, 2);
const compare = await call('GET', `/api/jobs/${jobId}/compare?a=1&b=2`);
show('differences', compare.body.differences);

const render = await call('POST', `/api/jobs/${jobId}/renders`, {
  cut: 2,
  width: 1280,
  burnTimecode: true,
});
check('render asked', render.status, 202);
const renderAgain = await call('POST', `/api/jobs/${jobId}/renders`, {
  cut: 2,
  width: 1280,
  burnTimecode: true,
});
check('same settings make no second render', renderAgain.status, 200);

// Review page and notes from the producer.
const producerId = madeProducer.body.id;
const review = await call('POST', `/api/jobs/${jobId}/reviews`, { producerId, cut: 2 });
check('review page', review.status, 201);
const token = review.body.url.split('/').pop();
const page = await call('GET', `/api/r/${token}`, undefined, { noCookie: true });
check('review page read', page.status, 200);
check('page language', page.body.language, 'fr');
check('page fields', Object.keys(page.body).sort().join(','),
  'aspect,cut,dueDate,endsAt,frameRate,frames,jobTitle,language,name,notes');
const length = await call('POST', `/api/r/${token}/length`, { length: '1,5' }, { noCookie: true });
check('french length', length.body, { seconds: '1.5', frames: 38 });
const badLength = await call('POST', `/api/r/${token}/length`, { length: '1.5' }, { noCookie: true });
check('english form refused in french', badLength.body.error.fields.length, 'Saisissez une durée comme 1,5.');

const sendKey = 'smoke-key-1';
const sent = await call('POST', `/api/r/${token}/notes`, {
  sendKey,
  name: 'ana reis',
  notes: [{ frame: 1, x: 41.5, y: 62, text: 'Un peu plus long.', suggestedLength: '1,5' }],
}, { noCookie: true });
check('notes sent', sent.status, 201);
const sentAgain = await call('POST', `/api/r/${token}/notes`, {
  sendKey,
  name: 'ana reis',
  notes: [{ frame: 1, x: 41.5, y: 62, text: 'Un peu plus long.' }],
}, { noCookie: true });
check('same send key stores nothing', sentAgain.status, 200);

const deskNotes = await call('GET', `/api/jobs/${jobId}/notes`);
check('note on the desk', deskNotes.body.total, 1);
show('desk note', deskNotes.body.notes[0]);

// Sign-off.
const signOff = await call('POST', `/api/jobs/${jobId}/sign-offs`, { producerId, cut: 2 });
const signToken = signOff.body.url.split('/').pop();
check('wrong name', (await call('POST', `/api/s/${signToken}/sign`, { name: 'Someone Else' }, { noCookie: true })).status, 422);
const signed = await call('POST', `/api/s/${signToken}/sign`, { name: 'ana reis' }, { noCookie: true });
check('signed off', signed.status, 200);
show('signed text', signed.body.signedOffText);
check('second sign', (await call('POST', `/api/s/${signToken}/sign`, { name: 'ana reis' }, { noCookie: true })).status, 409);

// Delivery.
const packaged = await call('POST', `/api/jobs/${jobId}/packages`, { cut: 2 });
check('package', packaged.status, 201);
show('files', packaged.body.files.map((f) => `${f.kind} ${f.size}`));
const edl = await call('GET', `/api/packages/${packaged.body.id}/files/editDecisionList`);
console.log('--- edit decision list ---');
console.log(JSON.stringify(edl.body).slice(0, 600));
const shots = await call('GET', `/api/packages/${packaged.body.id}/files/shotList`);
console.log('--- shot list ---');
console.log(JSON.stringify(shots.body).slice(0, 400));

// Fee letter.
const made = await call('POST', `/api/jobs/${jobId}/letter`, {
  currency: 'EUR',
  fee: '5506.50',
  scope: 'Boards and story reel for one :30',
});
check('letter', made.status, 201);
show('letter amounts', {
  fee: made.body.feeText,
  tax: made.body.taxText,
  total: made.body.totalText,
  milestones: made.body.milestones.map((m) => `${m.amountText} + ${m.taxText}`),
});

// Calls across a clock change.
const changeDates = ['2027-03-26', '2027-03-29'];
for (const date of changeDates) {
  const booked = await call('POST', '/api/calls', {
    producerId,
    date,
    time: '09:00',
    minutes: 30,
    note: 'First look, cut 2',
  });
  show(`call ${date}`, booked.status === 201 ? booked.body.text : booked.body.error);
}
const missing = await call('POST', '/api/calls', {
  producerId,
  date: '2027-03-14',
  time: '02:30',
  minutes: 30,
  note: '',
});
show('skipped time', missing.body.error?.message);

// Enquiries.
for (let index = 0; index < 6; index += 1) {
  const answer = await call('POST', '/api/enquiries', {
    name: 'Ana Reis',
    email: 'ana@example.test',
    message: 'Do you board a :15?',
  }, { noCookie: true });
  if (index === 0) check('enquiry', answer.body.message, 'Thanks. I answer within two working days.');
  if (index === 5) {
    check('sixth enquiry', answer.status, 429);
    check('retry after', Number(answer.headers.get('retry-after')) > 0, true);
    show('enquiry limit copy', answer.body.error.message);
  }
}

// Another desk's job is a 404 of the same shape.
const unknown = await call('GET', '/api/jobs/00000000-0000-4000-8000-000000000000');
check('unknown job', unknown.status, 404);
await call('POST', '/api/sign-out');
const theo = await call('POST', '/api/sign-in', {
  email: 'theo@noorbakkerboards.example',
  password: 'desk-pass-2027',
});
check('theo signs in', theo.status, 200);
const otherDesk = await call('GET', `/api/jobs/${jobId}`);
check('another desk job 404', otherDesk.status, 404);
check('same shape', JSON.stringify(otherDesk.body), JSON.stringify(unknown.body));

console.log(failures === 0 ? '\nall ok' : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
