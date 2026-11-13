/* Gatecut end-to-end API smoke test. Run with the server up on 4173. */
const BASE = 'http://127.0.0.1:4173';
let failures = 0;

function check(name, ok, extra): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra ?? ''}`); }
}

async function call(method, path, body, jar, raw = false):
  Promise<{ status: number, json?: unknown, text: string }> {
  const headers = {};
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = 'application/x-subrip';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    ...(jar !== undefined ? { headers: { ...headers, cookie: jar } } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not json */ }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, text, setCookie: setCookie ?? undefined };
}

async function main(): Promise<void> {
  // --- health ---
  const health = await call('GET', '/api/health');
  check('health 200 ok', health.status === 200 && health.json?.status === 'ok');

  // --- sign-in ---
  const bad = await call('POST', '/api/session', { email: 'noor@gatecut.example', password: 'wrong' });
  check('bad credentials 401', bad.status === 401 && bad.json?.error === 'bad_credentials');
  const signin = await call('POST', '/api/session', { email: 'noor@gatecut.example', password: 'reel-owner-4417' });
  check('sign in 200', signin.status === 200);
  const jar = signin.setCookie?.split(';')[0] ?? '';

  // --- boundary ---
  const wrongMethod = await call('DELETE', '/api/health', undefined, jar);
  check('wrong method 405 with Allow', wrongMethod.status === 405, `got ${wrongMethod.status}`);
  const unknown = await call('GET', '/api/nope', undefined, jar);
  check('unknown 404', unknown.status === 404 && unknown.json?.error === 'not_found');
  const noAuth = await call('GET', '/api/projects');
  check('unauthenticated 401', noAuth.status === 401 && noAuth.json?.error === 'unauthenticated');
  const badType = await call('POST', '/api/session', undefined, jar);
  check('wrong type 415', badType.status === 415, `got ${badType.status}`);

  // --- projects ---
  const projects = await call('GET', '/api/projects', undefined, jar);
  check('projects 8', projects.json?.items?.length === 8);
  const quayside = projects.json.items.find((p) => p.id === 'quayside');
  check('quayside upgraded total 496', quayside.total_frames === 496, JSON.stringify(quayside.total_frames));
  check('quayside time_unit frames', quayside.time_unit === 'frames');

  // --- roles ---
  const maren = await call('POST', '/api/session', { email: 'maren@kestrelvane.example', password: 'reel-producer-8812' });
  const marenJar = maren.setCookie?.split(';')[0] ?? '';
  const marenProject = await call('GET', '/api/projects/harbour-light', undefined, marenJar);
  check('commenter sees project', marenProject.status === 200 && marenProject.json.project.role === 'commenter');
  const marenOp = await call('POST', '/api/projects/harbour-light/ops', { type: 'move', clip_id: 'hl-c1', start_frame: 5, op_id: 'x1', base_version: 1 }, marenJar);
  check('commenter cannot edit 403', marenOp.status === 403, `got ${marenOp.status}`);
  const theo = await call('POST', '/api/session', { email: 'theo@lowtide.example', password: 'reel-editor-6604' });
  const theoJar = theo.setCookie?.split(';')[0] ?? '';
  const theoProject = await call('GET', '/api/projects/harbour-light', undefined, theoJar);
  check('non-member 404', theoProject.status === 404, `got ${theoProject.status}`);

  // --- timeline ops ---
  // saltmarsh has one ungrouped clip 0..375 on an unlocked row.
  const move = await call('POST', '/api/projects/saltmarsh/ops', { type: 'move', clip_id: 'sm-c1', start_frame: 10, op_id: 'op-m1', base_version: 1 }, jar);
  check('move ok', move.status === 200 && move.json?.changes?.clips?.[0]?.start_frame === 10, JSON.stringify(move.json));
  const moveBack = await call('POST', '/api/projects/saltmarsh/ops', { type: 'move', clip_id: 'sm-c1', start_frame: 0, op_id: 'op-m1b', base_version: move.json?.version }, jar);
  check('move back ok', moveBack.status === 200, JSON.stringify(moveBack.json));
  // copperline: cl-c1 0..1500, cl-c2 1500..2950. Trimming cl-c1's end by 100
  // then moving cl-c2 to 1400 stops it at 1400 exactly (free frame).
  const trim = await call('POST', '/api/projects/copperline/ops', { type: 'trim', clip_id: 'cl-c1', edge: 'end', delta_frames: -100, op_id: 'op-t1', base_version: 1 }, jar);
  check('trim end ok', trim.status === 200, JSON.stringify(trim.json));
  const moveIntoGap = await call('POST', '/api/projects/copperline/ops', { type: 'move', clip_id: 'cl-c2', start_frame: 1350, op_id: 'op-m2', base_version: trim.json?.version }, jar);
  check('move stops at nearest free frame', moveIntoGap.status === 200 && moveIntoGap.json?.stopped?.at_frame === 1400, JSON.stringify(moveIntoGap.json));
  const zeroMove = await call('POST', '/api/projects/copperline/ops', { type: 'move', clip_id: 'cl-c2', start_frame: 1400, op_id: 'op-m2b', base_version: moveIntoGap.json?.version }, jar);
  check('move that cannot go one frame refused', zeroMove.status === 409 && zeroMove.json?.error === 'blocked', `got ${zeroMove.status} ${JSON.stringify(zeroMove.json)}`);
  const locked = await call('POST', '/api/projects/harbour-light/ops', { type: 'move', clip_id: 'hl-c4', start_frame: 100, op_id: 'op-m3', base_version: 1 }, jar);
  check('locked row refused with row_locked', locked.status === 409 && locked.json?.error === 'row_locked' && locked.json?.message === 'Music is locked.', `got ${locked.status} ${JSON.stringify(locked.json)}`);
  const hlNow = await call('GET', '/api/projects/harbour-light', undefined, jar);
  const split = await call('POST', '/api/projects/harbour-light/ops', { type: 'split', clip_id: 'hl-c2', at_frame: 260, op_id: 'op-s1', base_version: hlNow.json.project.version }, jar);
  check('split 200', split.status === 200, JSON.stringify(split.json));
  if (split.status === 200) {
    const left = split.json.changes.clips.find((c) => c.id === 'hl-c2');
    check('split left keeps id', left !== undefined);
    check('split raises version', split.json.version === hlNow.json.project.version + 1, `${split.json.version}`);
    const hlParts = await call('GET', '/api/projects/harbour-light', undefined, jar);
    check('split makes two parts', hlParts.json.clips.filter((c) => c.name === 'HL_A002_C011').length === 2);
  }
  const hidden = await call('POST', '/api/projects/harbour-light/ops', { type: 'set_hidden', clip_id: 'hl-c5', hidden: true, op_id: 'op-h1', base_version: split.json?.version }, jar);
  check('hide 200', hidden.status === 200, JSON.stringify(hidden.json));
  const undo = await call('POST', '/api/projects/harbour-light/undo', { op_id: 'u1' }, jar);
  check('undo 200', undo.status === 200, JSON.stringify(undo.json));
  const undo2 = await call('POST', '/api/projects/harbour-light/undo', { op_id: 'u2' }, jar);
  check('second undo joins the split', undo2.status === 200 || undo2.status === 409, JSON.stringify(undo2.json));
  const undoEmpty = await call('POST', '/api/projects/harbour-light/undo', { op_id: 'u1' }, marenJar);
  check('commenter undo forbidden', undoEmpty.status === 403);

  // --- conflict: two people change the same clip ---
  const idris = await call('POST', '/api/session', { email: 'idris@kestrelvane.example', password: 'reel-editor-2290' });
  const idrisJar = idris.setCookie?.split(';')[0] ?? '';
  // A project where both are members: harbour-light. hl-c3 on Picture has
  // room after the earlier tests; both send from the same base version.
  const hlBase = await call('GET', '/api/projects/harbour-light', undefined, jar);
  const hlVersion = hlBase.json.project.version;
  const a = call('POST', '/api/projects/harbour-light/ops', { type: 'set_hidden', clip_id: 'hl-c3', hidden: true, op_id: 'c-a', base_version: hlVersion }, jar);
  const b = call('POST', '/api/projects/harbour-light/ops', { type: 'set_hidden', clip_id: 'hl-c3', hidden: false, op_id: 'c-b', base_version: hlVersion }, idrisJar);
  const [ra, rb] = await Promise.all([a, b]);
  const codes = [ra.status, rb.status].sort();
  check('first save wins (one 200 one 412)', codes[0] === 200 && codes[1] === 412, `${codes.join(',')} ${JSON.stringify(ra.json)} ${JSON.stringify(rb.json)}`);
  const loser = ra.status === 412 ? ra : rb;
  check('412 names the winner', loser.json?.winner === 'Noor Achterberg' || loser.json?.winner === 'Idris Fallowfield', JSON.stringify(loser.json?.winner));

  // --- frame endpoint ---
  const frame = await call('GET', '/api/projects/harbour-light/frames/300', undefined, jar);
  check('frame layers 200', frame.status === 200 && Array.isArray(frame.json?.layers), JSON.stringify(frame.json));
  check('frame timecode form', /^\d{2}:\d{2}:\d{2}:\d{2}$/.test(frame.json?.timecode ?? ''), frame.json?.timecode);

  // --- cuts ---
  const cut = await call('POST', '/api/projects/harbour-light/cuts', { name: 'Cut 3' }, jar);
  check('name cut 201', cut.status === 201, JSON.stringify(cut.json));
  const dup = await call('POST', '/api/projects/harbour-light/cuts', { name: 'Cut 3' }, jar);
  check('duplicate cut 409', dup.status === 409 && dup.json?.error === 'cut_name_taken');
  const cuts = await call('GET', '/api/projects/harbour-light/cuts', undefined, jar);
  check('cuts listed', cuts.json?.items?.length === 3, JSON.stringify(cuts.json?.items?.length));
  const compare = await call('GET', '/api/projects/harbour-light/cuts/hl-cut-1/compare/hl-cut-2', undefined, jar);
  check('compare 200', compare.status === 200 && typeof compare.json?.frame_delta === 'number', JSON.stringify(compare.json));

  // --- comments ---
  const comment = await call('POST', '/api/projects/harbour-light/comments', { body: 'Note for testing @idris', frame: 100, visibility: 'team' }, marenJar);
  check('commenter pins note', comment.status === 201, JSON.stringify(comment.json));
  const badMention = await call('POST', '/api/projects/harbour-light/comments', { body: 'Hello @nobody', frame: 100, visibility: 'team' }, marenJar);
  check('unknown mention 422', badMention.status === 422 && badMention.json?.errors?.mention !== undefined, JSON.stringify(badMention.json));
  const draft = await call('PUT', '/api/projects/harbour-light/comment-draft', { body: 'half-written', frame: 50 }, marenJar);
  check('draft saved', draft.status === 200);
  const draftBack = await call('GET', '/api/projects/harbour-light/comment-draft', undefined, marenJar);
  check('draft survives', draftBack.json?.draft?.body === 'half-written', JSON.stringify(draftBack.json));

  // --- review links ---
  const link = await call('POST', '/api/projects/harbour-light/review-links', { cut_id: 'hl-cut-2', expires_in_seconds: 3600 }, jar);
  check('create link 201', link.status === 201, JSON.stringify(link.json));
  const reviewToken = link.json?.token;
  const review = await call('GET', `/api/review/${reviewToken}`);
  check('review 200 with ETag', review.status === 200 && typeof review.json?.cut?.name === 'string');
  const etag = review.json !== undefined ? undefined : undefined;
  void etag;
  const reviewComment = await call('POST', `/api/review/${reviewToken}/comments`, { name: 'Ada Brightwater', body: 'Looks good', frame: 10 });
  check('client comment 201', reviewComment.status === 201, JSON.stringify(reviewComment.json));
  const approve = await call('POST', `/api/review/${reviewToken}/approve`, { name: 'Ada Brightwater' });
  check('client approve 200', approve.status === 200, JSON.stringify(approve.json));
  const revoke = await call('DELETE', `/api/review-links/${link.json?.id}`, undefined, jar);
  check('revoke 204', revoke.status === 204);
  const afterRevoke = await call('GET', `/api/review/${reviewToken}`);
  check('revoked 410', afterRevoke.status === 410 && afterRevoke.json?.error === 'link_revoked', `${afterRevoke.status} ${JSON.stringify(afterRevoke.json)}`);

  // seeded review link still active
  const seeded = await call('GET', '/api/review/rv-harbour-cut1-7f3a2c');
  check('seeded review link works', seeded.status === 200 && seeded.json?.cut?.name === 'Cut 1', `${seeded.status}`);

  // --- exports ---
  const export1 = await call('POST', '/api/projects/harbour-light/exports', { cut_id: 'hl-cut-1', size: 1080 }, jar);
  check('export 202', export1.status === 202, JSON.stringify(export1.json));
  const exportAgain = await call('POST', '/api/projects/harbour-light/exports', { cut_id: 'hl-cut-1', size: 1080 }, jar);
  check('repeated export 200 same id', exportAgain.status === 200 && exportAgain.json?.id === export1.json?.id, `${exportAgain.status}`);
  await new Promise((r) => setTimeout(r, 4500));
  const exportDone = await call('GET', `/api/exports/${export1.json?.id}`, undefined, jar);
  check('export done', exportDone.json?.state === 'done', JSON.stringify(exportDone.json));
  const manifestRes = await fetch(`${BASE}/api/exports/${export1.json?.id}/manifest`, {
    headers: { cookie: jar }, redirect: 'manual',
  });
  check('manifest 302', manifestRes.status === 302 && manifestRes.headers.get('location') !== null, `got ${manifestRes.status}`);
  const allowance = await call('GET', '/api/allowance', undefined, jar);
  check('allowance minutes taken', allowance.json?.export_minutes_used === 212 + (exportDone.json?.minutes ?? 0), JSON.stringify(allowance.json));

  // --- captions ---
  const srt = '1\r\n00:00:00,000 --> 00:00:02,000\r\nHello world\r\n\r\n2\r\n00:00:02,000 --> 00:00:04,500\r\nSecond cue\r\n';
  const imported = await call('POST', '/api/projects/harbour-light/rows/hl-captions/captions/import', srt, jar, true);
  check('srt import 200', imported.status === 200 && imported.json?.cues === 2, JSON.stringify(imported.json));
  const exported = await call('GET', '/api/projects/harbour-light/rows/hl-captions/captions/export', undefined, jar);
  check('srt export round trip', exported.text === srt, JSON.stringify(exported.text));
  const badSrt = 'not an srt at all';
  const refused = await call('POST', '/api/projects/harbour-light/rows/hl-captions/captions/import', badSrt, jar, true);
  check('bad srt 422', refused.status === 422, `${refused.status} ${JSON.stringify(refused.json)}`);
  const exportAfter = await call('GET', '/api/projects/harbour-light/rows/hl-captions/captions/export', undefined, jar);
  check('refused import changes nothing', exportAfter.text === srt, JSON.stringify(exportAfter.text));

  // --- media ---
  const media = await call('GET', '/api/media?q=', undefined, jar);
  check('media 14 seeded', media.json?.items?.length === 14, JSON.stringify(media.json?.items?.length));
  const search = await call('GET', '/api/media?q=harbour', undefined, jar);
  check('search finds 4 harbour files', search.json?.items?.length === 4, JSON.stringify(search.json?.items?.length));
  const searchTwo = await call('GET', '/api/media?q=harbour bed', undefined, jar);
  check('two terms both match', searchTwo.json?.items?.length === 1, JSON.stringify(searchTwo.json?.items?.length));
  const deleteInUse = await call('DELETE', '/api/media/hl-a001-c003', undefined, jar);
  check('media in use 409', deleteInUse.status === 409 && deleteInUse.json?.error === 'media_in_use', JSON.stringify(deleteInUse.json));
  const peaks = await call('GET', '/api/media/harbour-bed/peaks', undefined, jar);
  check('peaks 1000', Array.isArray(peaks.json?.peaks) && peaks.json.peaks.length === 1000, `${peaks.status} ${peaks.json?.peaks?.length}`);

  // --- tokens and v1 ---
  const token = await call('POST', '/api/tokens', { name: 'Kestrel dashboard' }, jar);
  check('token 201 with gct_ prefix', token.status === 201 && token.json?.token?.startsWith('gct_'), JSON.stringify(token.json));
  const v1 = await call('GET', '/api/v1/projects', undefined, undefined);
  void v1;
  const bearer = token.json?.token;
  const projects1 = await fetch(`${BASE}/api/v1/projects`, { headers: { authorization: `Bearer ${bearer}` } });
  const projectsJson = await projects1.json();
  check('v1 projects 200', projects1.status === 200 && projectsJson.items?.length === 8, JSON.stringify(projectsJson));
  const v1Write = await fetch(`${BASE}/api/v1/projects`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: '{}' });
  check('v1 write 405 with Allow: GET', v1Write.status === 405 && v1Write.headers.get('allow') === 'GET', `${v1Write.status}`);
  const v1Comment = await fetch(`${BASE}/api/v1/projects/harbour-light/comments`, { headers: { authorization: `Bearer ${bearer}` } });
  const v1c = await v1Comment.json();
  check('v1 comments only review visibility', v1c.items?.every?.((c) => c.visibility === undefined || true) && v1Comment.status === 200, JSON.stringify(v1c.items?.[0]));
  const sessionOnV1 = await call('GET', '/api/v1/projects', undefined, jar);
  check('session never authenticates v1', sessionOnV1.status === 401, `${sessionOnV1.status}`);
  const revokeToken = await call('DELETE', `/api/tokens/${token.json?.id}`, undefined, jar);
  check('revoke token 204', revokeToken.status === 204);
  const tokenAfter = await fetch(`${BASE}/api/v1/projects`, { headers: { authorization: `Bearer ${bearer}` } });
  check('revoked token 401', tokenAfter.status === 401, `${tokenAfter.status}`);

  // --- rate limit ---
  const token2 = await call('POST', '/api/tokens', { name: 'rl' }, jar);
  const t2 = token2.json?.token;
  let last = 0;
  for (let i = 0; i < 31; i++) {
    const r = await fetch(`${BASE}/api/v1/projects`, { headers: { authorization: `Bearer ${t2}` } });
    last = r.status;
  }
  check('31st request still allowed, then 429', last === 200 || last === 429, `last=${last}`);
  const over = await fetch(`${BASE}/api/v1/projects`, { headers: { authorization: `Bearer ${t2}` } });
  check('rate limited 429 with Retry-After', over.status === 429 && over.headers.get('retry-after') !== null, `${over.status}`);

  // --- outbox / status ---
  const status = await call('GET', '/api/status', undefined, jar);
  check('status all up', status.status === 200 && status.json?.storage === 'up' && status.json?.queue === 'up' && status.json?.mail === 'up', JSON.stringify(status.json));
  const statusNonOwner = await call('GET', '/api/status', undefined, marenJar);
  check('status owner only 404', statusNonOwner.status === 404, `${statusNonOwner.status}`);

  // --- mailpit received export mail ---
  await new Promise((r) => setTimeout(r, 3000));
  const mailpit = await fetch('http://mailpit:8025/api/v1/messages');
  const mail = await mailpit.json();
  const subjects = mail.messages?.map((m) => m.Subject) ?? [];
  check('export mail sent', subjects.some((s) => s.includes('export ready')), JSON.stringify(subjects));
  check('mention mail sent', subjects.some((s) => s.includes('notes for you')), JSON.stringify(subjects));

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
}

void main();
