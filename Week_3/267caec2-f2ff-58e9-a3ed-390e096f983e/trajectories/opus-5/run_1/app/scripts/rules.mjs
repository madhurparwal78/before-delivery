import { computeRoundScores, roundHalfUp } from '/app/dist/server/domain/scoring.js';
import { cutoffInstant, dateLabel, withOffset } from '/app/dist/server/domain/time.js';
import { PNG } from '/app/node_modules/pngjs/lib/png.js';

const BASE = 'http://127.0.0.1:4173';
let failures = 0;
const check = (label, ok, extra) => {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`);
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function png(seed) {
  const image = new PNG({ width: 700, height: 700 });
  for (let i = 0; i < 700 * 700; i += 1) {
    image.data[i * 4] = (i * seed) % 255;
    image.data[i * 4 + 1] = (i * 23) % 255;
    image.data[i * 4 + 2] = (i * 41) % 255;
    image.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(image);
}

class Client {
  constructor() {
    this.cookie = null;
  }

  async call(method, path, body, headers = {}) {
    const init = { method, headers: { ...headers } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (this.cookie) init.headers.cookie = this.cookie;
    const response = await fetch(`${BASE}${path}`, init);
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  }

  signIn(email, password) {
    return this.call('POST', '/api/session', { email, password });
  }
}

async function main() {
  console.log('pure domain rules');
  const brief = computeRoundScores([
    { jurorId: 'j1', entryId: 'a', craft: 8, clarity: 8, idea: 8, story: 8 },
    { jurorId: 'j1', entryId: 'b', craft: 6, clarity: 6, idea: 6, story: 6 },
    { jurorId: 'j1', entryId: 'c', craft: 4, clarity: 4, idea: 4, story: 4 },
  ]);
  const byEntry = Object.fromEntries(brief.map((row) => [row.entryId, row.score.toFixed(2)]));
  check('brief scoring example', byEntry.a === '6.84' && byEntry.b === '5.00' && byEntry.c === '3.16', byEntry);

  const single = computeRoundScores([{ jurorId: 'j1', entryId: 'a', craft: 9, clarity: 9, idea: 9, story: 9 }]);
  check('single score maps to 5.00', single[0].score.toFixed(2) === '5.00', single[0]);

  const trimmed = computeRoundScores(
    [10, 9, 8, 7, 1].map((value, index) => ({
      jurorId: `j${index}`,
      entryId: 'a',
      craft: value,
      clarity: value,
      idea: value,
      story: value,
    })),
  );
  check('five ballots trim to three', trimmed[0].ballotsCounted === 5 && trimmed[0].score === 5, trimmed[0]);
  check('round half up on 6.125', roundHalfUp(6.125, 2) === 6.13, roundHalfUp(6.125, 2));

  check(
    'Asia/Kolkata boundary',
    withOffset(cutoffInstant('2026-12-31', 'Asia/Kolkata'), 'Asia/Kolkata') === '2027-01-01T00:00:00+05:30',
    withOffset(cutoffInstant('2026-12-31', 'Asia/Kolkata'), 'Asia/Kolkata'),
  );
  check(
    'deadline label',
    dateLabel('2026-12-31', 'Asia/Kolkata') === '23:59 Asia/Kolkata, 31 Dec 2026',
    dateLabel('2026-12-31', 'Asia/Kolkata'),
  );

  console.log('conflicts, recusal and packets');
  const director = new Client();
  await director.signIn('director@cutline.example', 'director-pass-26');
  const studios = await director.call('GET', '/api/studios');
  const programs = await director.call('GET', '/api/programs');
  const open = programs.body.programs.find((program) => program.entriesOpen);
  const commerce = open.categories.find((category) => category.name === 'Commerce');

  const entrants = [
    ['studio@halftone.example', 'halftone-pass-26', 'Halftone Works'],
    ['hello@fieldnote.example', 'fieldnote-pass-26', 'Fieldnote Studio'],
    ['team@parallaxpine.example', 'parallax-pass-26', 'Parallax & Pine'],
  ];
  const created = [];
  for (const [email, password, name] of entrants) {
    const client = new Client();
    await client.signIn(email, password);
    const entry = await client.call('POST', '/api/entries', {
      categoryId: commerce.id,
      title: `${name} Commerce`,
      summary: 'A commerce case study.',
      siteUrl: 'https://commerce.example',
      credits: '',
    });
    const form = new FormData();
    form.append('file', new Blob([png(created.length + 3)], { type: 'image/png' }), 'c.png');
    await client.call('POST', `/api/entries/${entry.body.entry.id}/assets`, form);
    const submitted = await client.call(
      'POST',
      `/api/entries/${entry.body.entry.id}/submit`,
      {},
      { 'idempotency-key': `rules-${created.length}` },
    );
    created.push({ name, entry: submitted.body.entry });
  }
  check('three commerce entries', created.length === 3 && created.every((item) => item.entry.state === 'submitted'));

  await director.call('PATCH', `/api/programs/${open.id}`, {
    earlyBirdDate: '2024-01-01',
    deadlineDate: '2024-01-10',
  });
  const screening = await director.call('GET', `/api/categories/${commerce.id}/entries`);
  for (const entry of screening.body.entries) {
    await director.call('POST', `/api/entries/${entry.id}/screen`, { decision: 'pass' });
  }

  const summary = await director.call('GET', `/api/programs/${open.id}/summary`);
  const commerceSummary = summary.body.categories.find((item) => item.name === 'Commerce');
  check('summary counts agree', commerceSummary.counts.screened === 3, commerceSummary.counts);
  const roundOne = commerceSummary.rounds.find((item) => item.name === 'Round 1');

  const jurors = await director.call('GET', '/api/jurors');
  const ines = jurors.body.jurors.find((juror) => juror.name === 'Ines Varga');
  const sana = jurors.body.jurors.find((juror) => juror.name === 'Sana Kobayashi');
  const ruth = jurors.body.jurors.find((juror) => juror.name === 'Ruth Calder');

  const withInes = await director.call('POST', `/api/rounds/${roundOne.id}/jurors`, { jurorId: ines.id });
  check(
    'home studio excluded in scheduled round',
    withInes.body.panel.find((row) => row.jurorId === ines.id).assigned === 2,
    withInes.body.panel,
  );
  const withSana = await director.call('POST', `/api/rounds/${roundOne.id}/jurors`, { jurorId: sana.id });
  check(
    'seeded conflict excluded',
    withSana.body.panel.find((row) => row.jurorId === sana.id).assigned === 2,
    withSana.body.panel,
  );
  const withRuth = await director.call('POST', `/api/rounds/${roundOne.id}/jurors`, { jurorId: ruth.id });
  check(
    'clear juror gets all three',
    withRuth.body.panel.find((row) => row.jurorId === ruth.id).assigned === 3,
    withRuth.body.panel,
  );
  const repeated = await director.call('POST', `/api/rounds/${roundOne.id}/jurors`, { jurorId: ruth.id });
  check('repeat panel add is 200', repeated.status === 200, repeated.status);

  const earlyClose = await director.call('POST', `/api/rounds/${roundOne.id}/close`, {});
  check('close before open 409', earlyClose.status === 409 && earlyClose.body.error === 'invalid_transition', earlyClose.body);

  const finalRound = commerceSummary.rounds.find((item) => item.name === 'Final round');
  await director.call('POST', `/api/rounds/${finalRound.id}/jurors`, { jurorId: ruth.id });
  const earlyFinal = await director.call('POST', `/api/rounds/${finalRound.id}/open`, { ballotDeadline: '2030-01-01' });
  check(
    'final before round 1 confirmed',
    earlyFinal.status === 409 && earlyFinal.body.error === 'previous_round_not_confirmed',
    earlyFinal.body,
  );

  const opened = await director.call('POST', `/api/rounds/${roundOne.id}/open`, { ballotDeadline: '2030-01-01' });
  check('round opens', opened.status === 200, opened.body);

  await sleep(1200);
  const packet = await readPacket(roundOne.id);
  check(
    'jury packet keys',
    packet !== null &&
      Object.keys(packet).join(',') === 'roundId,roundName,categoryName,ballotDeadlineLabel,entries' &&
      packet.entries.length === 3 &&
      Object.keys(packet.entries[0]).join(',') === 'entryNumber,title,summary,assetIds',
    packet === null ? 'missing' : Object.keys(packet),
  );

  const ruthClient = new Client();
  await ruthClient.signIn('ruth@jury.example', 'juror-pass-26');
  const ballot = await ruthClient.call('GET', `/api/rounds/${roundOne.id}/ballot`);
  check('ruth sees three entries', ballot.body.entries.length === 3, ballot.body.assigned);
  check(
    'blind entry keys',
    Object.keys(ballot.body.entries[0]).join(',') === 'entryId,entryNumber,title,summary,images,scores',
    Object.keys(ballot.body.entries[0]),
  );

  const halftone = studios.body.studios.find((studio) => studio.name === 'Halftone Works');
  const conflict = await ruthClient.call('POST', '/api/conflicts', {
    studioId: halftone.id,
    note: 'Worked together last year',
  });
  check(
    'conflict removes one assignment',
    conflict.status === 201 && conflict.body.removedAssignments === 1,
    conflict.body,
  );
  const afterConflict = await ruthClient.call('GET', `/api/rounds/${roundOne.id}/ballot`);
  check('ballot drops the conflicted entry', afterConflict.body.entries.length === 2, afterConflict.body.assigned);

  const recused = await ruthClient.call(
    'POST',
    `/api/rounds/${roundOne.id}/entries/${afterConflict.body.entries[0].entryId}/recuse`,
    { note: 'I recognise this one' },
  );
  check('recusal leaves one', recused.status === 200 && recused.body.remaining === 1, recused.body);

  const panelNow = await director.call('GET', `/api/rounds/${roundOne.id}`);
  const ruthRow = panelNow.body.panel.find((row) => row.jurorId === ruth.id);
  const ruthBallot = await ruthClient.call('GET', `/api/rounds/${roundOne.id}/ballot`);
  check(
    'panel row agrees with ballot',
    ruthRow.assigned === ruthBallot.body.assigned && ruthRow.remaining === ruthBallot.body.remaining,
    { ruthRow, assigned: ruthBallot.body.assigned },
  );

  const incomplete = await ruthClient.call('POST', `/api/rounds/${roundOne.id}/ballot/submit`, {});
  check(
    'incomplete ballot 409',
    incomplete.status === 409 && incomplete.body.error === 'ballot_incomplete',
    incomplete.body,
  );
  const last = ruthBallot.body.entries[0];
  await ruthClient.call('PUT', `/api/rounds/${roundOne.id}/scores/${last.entryId}`, {
    craft: 7,
    clarity: 8,
    idea: 6,
    story: 9,
  });
  const submittedBallot = await ruthClient.call('POST', `/api/rounds/${roundOne.id}/ballot/submit`, {});
  check('ballot counted', submittedBallot.body.counted === 1, submittedBallot.body);

  await sleep(2500);
  const rewritten = await readPacket(roundOne.id);
  check('packet rewritten after changes', rewritten !== null && rewritten.entries.length === 3);

  const audit = await director.call('GET', '/api/audit');
  const actions = audit.body.events.map((event) => event.action);
  check(
    'audit holds only director actions',
    actions.every((action) =>
      [
        'program.create',
        'program.update',
        'category.create',
        'juror.create',
        'entry.pass',
        'entry.disqualify',
        'entry.reinstate',
        'panel.add',
        'round.open',
        'round.close',
        'round.confirm',
        'category.publish',
      ].includes(action),
    ),
    [...new Set(actions)],
  );

  console.log(failures === 0 ? '\nRULE CHECKS PASSED' : `\n${failures} RULE CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

async function readPacket(roundId) {
  const { getObject } = await import('/app/dist/server/providers/storage.js');
  const body = await getObject(`rounds/${roundId}/jury-packet.json`);
  return body === null ? null : JSON.parse(body.toString('utf8'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
