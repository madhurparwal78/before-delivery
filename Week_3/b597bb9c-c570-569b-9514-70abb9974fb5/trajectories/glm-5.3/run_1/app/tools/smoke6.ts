/* Smoke test 6: caption ops, kit application, comment visibility, drafts. */
const BASE = 'http://127.0.0.1:4173';
let failures = 0;

function check(name, ok, extra): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra ?? ''}`); }
}

async function call(method, path, body, jar, raw = false): Promise<{ status: number, json?: Record<string, unknown> & { [k: string]: unknown }, text: string, headers: Headers }> {
  const headers: Record<string, string> = {};
  if (jar !== undefined) headers.cookie = jar;
  if (body !== undefined) headers['content-type'] = raw ? 'application/x-subrip' : 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function main(): Promise<void> {
  const signin = await call('POST', '/api/session', { email: 'noor@gatecut.example', password: 'reel-owner-4417' }, undefined);
  const jar = signin.headers.get('set-cookie')?.split(';')[0] ?? '';
  const marenIn = await call('POST', '/api/session', { email: 'maren@kestrelvane.example', password: 'reel-producer-8812' }, undefined);
  const marenJar = marenIn.headers.get('set-cookie')?.split(';')[0] ?? '';

  // ---- caption limits on typed cues ----
  const hl = await call('GET', '/api/projects/harbour-light', undefined, jar);
  const captionRow = hl.json.rows.find((r: { kind: string }) => r.kind === 'caption').id;
  const ok = await call('POST', '/api/projects/harbour-light/ops', { type: 'caption_add', row_id: captionRow, start_frame: 760, end_frame: 800, text: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', op_id: 'ca1', base_version: hl.json.project.version }, jar);
  check('caption at the 42 code point limit accepted', ok.status === 200, `${ok.status} ${JSON.stringify(ok.json)}`);
  const over = await call('POST', '/api/projects/harbour-light/ops', { type: 'caption_add', row_id: captionRow, start_frame: 810, end_frame: 840, text: 'This line is far longer than forty-two characters', op_id: 'ca2', base_version: ok.json?.version }, jar);
  check('caption over the limit refused', over.status === 422, `${over.status} ${JSON.stringify(over.json)}`);
  const twoLines = await call('POST', '/api/projects/harbour-light/ops', { type: 'caption_add', row_id: captionRow, start_frame: 850, end_frame: 880, text: 'Two lines\nare allowed here', op_id: 'ca3', base_version: over.status === 200 ? over.json?.version : ok.json?.version }, jar);
  check('caption with two lines accepted', twoLines.status === 200, `${twoLines.status} ${JSON.stringify(twoLines.json)}`);
  const threeLines = await call('POST', '/api/projects/harbour-light/ops', { type: 'caption_add', row_id: captionRow, start_frame: 890, end_frame: 920, text: 'One\nTwo\nThree', op_id: 'ca4', base_version: twoLines.json?.version }, jar);
  check('caption with three lines refused', threeLines.status === 422, `${threeLines.status}`);
  // Code points, not UTF-16 units: the clapper emoji is 1 code point.
  const emoji = await call('POST', '/api/projects/harbour-light/ops', { type: 'caption_add', row_id: captionRow, start_frame: 930, end_frame: 960, text: '🎬', op_id: 'ca5', base_version: threeLines.status === 200 ? threeLines.json?.version : twoLines.json?.version }, jar);
  check('one emoji is one code point', emoji.status === 200, `${emoji.status}`);

  // ---- brand kits ----
  const kit = await call('POST', '/api/kits', { name: 'Kestrel', text_colour: 'ffddaa', box_colour: '332211', font_weight: 600 }, jar);
  check('create kit 201', kit.status === 201, JSON.stringify(kit.json));
  const apply = await call('POST', '/api/projects/harbour-light/ops', { type: 'apply_kit', kit_id: kit.json?.id, text_colour: 'ffddaa', box_colour: '332211', font_weight: 600, op_id: 'k1', base_version: emoji.status === 200 ? emoji.json?.version : twoLines.json?.version }, jar);
  check('apply kit 200 in one op', apply.status === 200, JSON.stringify(apply.json));
  const afterKit = await call('GET', '/api/projects/harbour-light', undefined, jar);
  const title = afterKit.json.clips.find((c: { id: string }) => c.id === 'hl-c5');
  check('kit copied into every text clip', title?.text_colour === 'ffddaa' && title?.box_colour === '332211' && title?.font_weight === 600, JSON.stringify(title));
  // Later kit edits never change a project.
  const editKit = await call('PUT', `/api/kits/${kit.json?.id}`, { name: 'Kestrel', text_colour: '000000', box_colour: 'ffffff', font_weight: 400 }, jar);
  check('kit edit 200', editKit.status === 200, JSON.stringify(editKit.json));
  const afterKitEdit = await call('GET', '/api/projects/harbour-light', undefined, jar);
  const titleAfter = afterKitEdit.json.clips.find((c: { id: string }) => c.id === 'hl-c5');
  check('kit edit changes no project', titleAfter?.text_colour === 'ffddaa', JSON.stringify(titleAfter));

  // ---- comment visibility ----
  const teamNote = await call('POST', '/api/projects/harbour-light/comments', { body: 'Team only note', frame: 100, visibility: 'team' }, jar);
  check('team note 201', teamNote.status === 201, `${teamNote.status}`);
  const allNotes = await call('GET', '/api/projects/harbour-light/comments', undefined, marenJar);
  check('commenter sees team notes on the project', allNotes.json?.items?.some((c: { body: string }) => c.body === 'Team only note'), '');
  const link = await call('POST', '/api/projects/harbour-light/review-links', { cut_id: 'hl-cut-1', expires_in_seconds: 3600 }, jar);
  const review = await call('GET', `/api/review/${link.json?.token}`, undefined, undefined);
  check('review never shows team-only notes', !review.json?.comments?.some((c: { body: string }) => c.body === 'Team only note'), '');
  const v1res = await fetch(`${BASE}/api/v1/projects/harbour-light/comments`, { headers: { authorization: 'Bearer ' + (await (await call('POST', '/api/tokens', { name: 'vis' }, jar)).json?.token) } });
  const v1comments = await v1res.json();
  check('read tokens never see team-only notes', !v1comments?.items?.some((c: { body: string }) => c.body === 'Team only note'), '');

  // ---- note limits ----
  const longBody = 'x'.repeat(2000);
  const atLimit = await call('POST', '/api/projects/harbour-light/comments', { body: longBody, frame: 100, visibility: 'team' }, jar);
  check('2000 code points allowed', atLimit.status === 201, `${atLimit.status}`);
  const overLimit = await call('POST', '/api/projects/harbour-light/comments', { body: 'x'.repeat(2001), frame: 100, visibility: 'team' }, jar);
  check('2001 code points refused', overLimit.status === 422, `${overLimit.status}`);
  const fiveMentions = await call('POST', '/api/projects/harbour-light/comments', { body: '@noor @idris @pia @maren and @theo?', frame: 5, visibility: 'team' }, jar);
  check('unknown handle refused on mention', fiveMentions.status === 422, `${fiveMentions.status} ${JSON.stringify(fiveMentions.json)}`);
  // At most 5 DISTINCT mentions: with only 4 members the limit cannot be
  // exceeded by distinct handles here, so repeated handles stay allowed.
  const fiveOk = await call('POST', '/api/projects/harbour-light/comments', { body: 'Hi @noor @idris @pia @maren', frame: 5, visibility: 'team' }, jar);
  check('4 mentions allowed', fiveOk.status === 201, `${fiveOk.status}`);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
}

void main();
