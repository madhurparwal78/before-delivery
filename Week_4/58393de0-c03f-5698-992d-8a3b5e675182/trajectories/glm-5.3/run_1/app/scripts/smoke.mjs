#!/usr/bin/env node
// End-to-end API smoke test against a running server.
const BASE = 'http://127.0.0.1:4173';
const TOKEN = 'qy-grading-local';
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

async function req(method, path, { body, headers, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}), ...headers },
    body: body !== undefined ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  // 1. seed
  const seed = await req('POST', '/api/grading/seed', { headers: { 'X-Grading-Token': TOKEN } });
  check('seed 200', seed.status === 200, seed.text.slice(0, 200));
  const S = seed.json;
  check('seed storageSeeded', S.storageSeeded === true);
  check('seed classroom', S.classroom.joinCode === 'ROBO42');
  check('seed students', S.students.length === 2);
  check('seed projects', S.projects.length === 9);
  const classroomId = S.classroom.id;
  const tinyId = S.students[0].id;

  // 2. health
  const health = await req('GET', '/api/health');
  check('health ok', health.status === 200 && health.json.status === 'ok');

  // 3. sign in as educator via grading session
  const ses = await fetch(`${BASE}/api/grading/session?user=${S.educator.id}&token=${TOKEN}`, { redirect: 'manual' });
  const cookie = ses.headers.get('set-cookie')?.split(';')[0];
  check('grading session 302', ses.status === 302, String(ses.status));
  check('session cookie', Boolean(cookie));
  const auth = { Cookie: cookie };

  // 4. session endpoint
  const me = await req('GET', '/api/session', { headers: auth });
  check('session account', me.status === 200 && me.json.account?.email === 'dana@hollowbrook.test');

  // 5. classrooms list
  const classrooms = await req('GET', '/api/classrooms', { headers: auth });
  check('classrooms list', classrooms.status === 200 && classrooms.json.classrooms.length === 1);
  check('classroom state open', classrooms.json.classrooms[0].state === 'open');
  check('classroom role owner', classrooms.json.classrooms[0].role === 'owner');
  const cls = classrooms.json.classrooms[0];
  check('roster students', cls.students.length === 2);
  check('student handedIn false', cls.students[0].handedIn === false);
  check('latest project gear box', cls.students[0].latestProject?.name === 'Gear Box');
  check('latest project rev 3', cls.students[0].latestProject?.revision === 3);
  check('secondsToHandIn > 0', cls.secondsToHandIn > 13 * 86400);

  // 6. join code replace
  const newCode = await req('POST', `/api/classrooms/${classroomId}/join-code`, { headers: auth, body: {} });
  check('new code 200', newCode.status === 200 && typeof newCode.json.joinCode === 'string' && newCode.json.joinCode.length === 6);
  const oldCode = await req('POST', '/api/join/code', { body: { code: 'ROBO42' } });
  check('old code unknown', oldCode.status === 404 && oldCode.json.error === 'unknown_code');
  const codeRes = await req('POST', '/api/join/code', { body: { code: newCode.json.joinCode.toLowerCase() } });
  check('join code 200', codeRes.status === 200 && codeRes.json.classroom.name === 'Robotics Lab');
  const pendingCookie = codeRes.headers.get('set-cookie')?.split(';')[0];
  const pendingAuth = { Cookie: pendingCookie };

  // 7. pending session restrictions
  const pendingSession = await req('GET', '/api/session', { headers: pendingAuth });
  check('pending session reports', pendingSession.status === 200 && pendingSession.json.account === null && pendingSession.json.pendingJoin?.classroomName === 'Robotics Lab');
  const blocked = await req('GET', '/api/classrooms', { headers: pendingAuth });
  check('pending blocked 401', blocked.status === 401 && blocked.json.error === 'signed_out');

  // 8. nickname collision case-insensitively
  const taken = await req('POST', '/api/join/nickname', { headers: pendingAuth, body: { nickname: 'tiny turtle' } });
  check('nickname_taken case-insensitive', taken.status === 409 && taken.json.error === 'nickname_taken');
  const invalid = await req('POST', '/api/join/nickname', { headers: pendingAuth, body: { nickname: 'x' } });
  check('nickname invalid 422', invalid.status === 422 && invalid.json.error === 'validation');
  const joined = await req('POST', '/api/join/nickname', { headers: pendingAuth, body: { nickname: 'zoë 2' } });
  check('join 201', joined.status === 201 && joined.json.account.kind === 'student');
  const studentCookie = joined.headers.get('set-cookie')?.split(';')[0];
  check('student cookie differs', studentCookie !== pendingCookie);
  const studentAuth = { Cookie: studentCookie };

  // 9. student classroom view
  const classView = await req('GET', '/api/class', { headers: studentAuth });
  check('class view', classView.status === 200 && classView.json.name === 'Robotics Lab');
  check('class view state', classView.json.state === 'open');
  check('class view countdown', classView.json.secondsToHandIn > 0);

  // 10. student forbidden on classroom routes
  const forbidden = await req('GET', `/api/classrooms/${classroomId}`, { headers: studentAuth });
  check('student classroom 403', forbidden.status === 403 && forbidden.json.error === 'forbidden');
  const rosterForbidden = await req('PATCH', `/api/classrooms/${classroomId}/students/${tinyId}`, { headers: studentAuth, body: { nickname: 'Xy' } });
  check('student rename 403', rosterForbidden.status === 403);

  // 11. project create + revisions
  const created = await req('POST', '/api/projects', { headers: studentAuth, body: { kind: '3d', name: 'Test Part', snapshot: { kind: '3d', objects: [], workplane: { origin: [0, 0, 0], normal: [0, 0, 1] } } } });
  check('project create 201', created.status === 201 && created.json.project.revision === 1);
  const pid = created.json.project.id;
  const saved = await req('PUT', `/api/projects/${pid}`, { headers: studentAuth, body: { baseRevision: 1, snapshot: { kind: '3d', objects: [], workplane: { origin: [0, 0, 0], normal: [0, 0, 1] } } } });
  check('project save 200 rev 2', saved.status === 200 && saved.json.project.revision === 2);
  const stale = await req('PUT', `/api/projects/${pid}`, { headers: studentAuth, body: { baseRevision: 1, snapshot: { kind: '3d', objects: [], workplane: { origin: [0, 0, 0], normal: [0, 0, 1] } } } });
  check('stale revision 409', stale.status === 409 && stale.json.error === 'stale_revision' && stale.json.currentRevision === 2);
  const kindMismatch = await req('PUT', `/api/projects/${pid}`, { headers: studentAuth, body: { baseRevision: 2, snapshot: { kind: 'circuit', components: [], wires: [] } } });
  check('kind mismatch 422', kindMismatch.status === 422);

  // 12. idempotency
  const snap = { kind: '3d', objects: [], workplane: { origin: [0, 0, 0], normal: [0, 0, 1] } };
  const idem = { 'Idempotency-Key': 'test-key-1' };
  const first = await req('PUT', `/api/projects/${pid}`, { headers: { ...studentAuth, ...idem }, body: { baseRevision: 2, snapshot: snap } });
  check('idem first 200', first.status === 200 && first.json.project.revision === 3);
  const replay = await req('PUT', `/api/projects/${pid}`, { headers: { ...studentAuth, ...idem }, body: { baseRevision: 2, snapshot: snap } });
  check('idem replay same revision', replay.status === 200 && replay.json.project.revision === 3);
  const conflict = await req('PUT', `/api/projects/${pid}`, { headers: { ...studentAuth, 'Idempotency-Key': 'test-key-1' }, body: { baseRevision: 3, snapshot: snap } });
  check('idem conflict 409', conflict.status === 409 && conflict.json.error === 'idempotency_conflict');

  // 13. visibility: educator sees student project; personal maker cannot
  const asEducator = await req('GET', `/api/projects/${pid}`, { headers: auth });
  check('educator sees student project', asEducator.status === 200 && asEducator.json.project.name === 'Test Part');
  const personalSes = await fetch(`${BASE}/api/grading/session?user=${S.personal.id}&token=${TOKEN}`, { redirect: 'manual' });
  const personalCookie = personalSes.headers.get('set-cookie')?.split(';')[0];
  const personalAuth = { Cookie: personalCookie };
  const asPersonal = await req('GET', `/api/projects/${pid}`, { headers: personalAuth });
  check('personal cannot see student project', asPersonal.status === 404 && asPersonal.json.error === 'not_found');
  const asPersonalWrite = await req('PUT', `/api/projects/${pid}`, { headers: personalAuth, body: { baseRevision: 3, snapshot: snap } });
  check('personal write 404', asPersonalWrite.status === 404);

  // 14. unverified personal maker cannot create/save/export
  const unverifiedCreate = await req('POST', '/api/projects', { headers: personalAuth, body: { kind: '3d', name: 'Nope', snapshot: snap } });
  check('unverified create 403', unverifiedCreate.status === 403 && unverifiedCreate.json.error === 'email_unverified');
  const unverifiedClassroom = await req('POST', '/api/classrooms', { headers: personalAuth, body: { name: 'X', timeZone: 'America/Chicago' } });
  check('unverified classroom 403', unverifiedClassroom.status === 403 && unverifiedClassroom.json.error === 'email_unverified');

  // 15. resend verification rate limit (seed sends no email for Priya)
  const resend1 = await req('POST', '/api/auth/resend-verification', { headers: personalAuth });
  check('resend 202', resend1.status === 202, resend1.text.slice(0, 120));
  const resend2 = await req('POST', '/api/auth/resend-verification', { headers: personalAuth });
  check('resend rate limited 429', resend2.status === 429 && resend2.json.error === 'rate_limited');
  check('retryAfterSeconds', typeof resend2.json.retryAfterSeconds === 'number');
  check('Retry-After header', resend2.headers.get('retry-after') !== null);

  // 16. classroom creation with defaults + validation
  const created2 = await req('POST', '/api/classrooms', { headers: auth, body: { name: 'Space Camp', timeZone: 'America/Chicago' } });
  check('classroom create 201', created2.status === 201);
  check('classroom default join opens ~now', created2.json.joinOpensAt !== undefined);
  check('classroom default join closes +14d', Math.round((new Date(created2.json.joinClosesAt) - new Date(created2.json.joinOpensAt)) / 86400000) === 14);
  check('classroom default hand-in +70d', Math.round((new Date(created2.json.handInAt) - new Date(created2.json.joinOpensAt)) / 86400000) === 70);
  check('classroom state open', created2.json.state === 'open', created2.json.state);
  const badTz = await req('POST', '/api/classrooms', { headers: auth, body: { name: 'X', timeZone: 'Not/AZone' } });
  check('bad timezone 422', badTz.status === 422 && badTz.json.fields?.timeZone !== undefined);
  const badOrder = await req('POST', '/api/classrooms', { headers: auth, body: { name: 'X', timeZone: 'America/Chicago', joinOpensLocal: '2026-12-01T09:00', joinClosesLocal: '2026-11-01T09:00' } });
  check('join order 422', badOrder.status === 422 && badOrder.json.fields?.joinClosesLocal !== undefined);
  const badHandIn = await req('POST', '/api/classrooms', { headers: auth, body: { name: 'X', timeZone: 'America/Chicago', joinOpensLocal: '2026-12-20T09:00', joinClosesLocal: '2027-01-20T09:00', handInLocal: '2027-01-05T09:00' } });
  check('hand-in before join closes 422', badHandIn.status === 422 && badHandIn.json.fields?.handInLocal === 'Hand-in time must be at or after Join closes.');
  const pastHandIn = await req('POST', '/api/classrooms', { headers: auth, body: { name: 'X', timeZone: 'America/Chicago', joinOpensLocal: '2026-11-01T09:00', joinClosesLocal: '2026-11-02T09:00', handInLocal: '2026-11-01T09:30' } });
  check('hand-in in past 422 (not-later-than-now copy first)', pastHandIn.status === 422 && pastHandIn.json.fields?.handInLocal === 'Hand-in time must be later than now.');
  const gapHandIn = await req('POST', '/api/classrooms', { headers: auth, body: { name: 'X', timeZone: 'America/Chicago', joinOpensLocal: '2026-11-01T09:00', joinClosesLocal: '2026-11-02T09:00', handInLocal: '2026-03-08T02:30' } });
  check('dst gap 422', gapHandIn.status === 422 && gapHandIn.json.fields?.handInLocal?.startsWith('That time does not exist'), JSON.stringify(gapHandIn.json));
  const badFormat = await req('POST', '/api/classrooms', { headers: auth, body: { name: 'X', timeZone: 'America/Chicago', joinOpensLocal: '2026-11-01 9:00' } });
  check('bad format 422', badFormat.status === 422 && badFormat.json.fields?.joinOpensLocal === 'Use the form YYYY-MM-DD HH:mm.');

  // 17. assistant permissions
  const assistantSes = await fetch(`${BASE}/api/grading/session?user=${S.assistant.id}&token=${TOKEN}`, { redirect: 'manual' });
  const assistantCookie = assistantSes.headers.get('set-cookie')?.split(';')[0];
  const assistantAuth = { Cookie: assistantCookie };
  const assistantList = await req('GET', '/api/classrooms', { headers: assistantAuth });
  check('assistant sees one classroom', assistantList.status === 200 && assistantList.json.classrooms.length === 1);
  check('assistant role', assistantList.json.classrooms[0].role === 'assistant');
  const assistantEditTimes = await req('PATCH', `/api/classrooms/${classroomId}`, { headers: assistantAuth, body: { handInLocal: '2030-01-01T09:00' } });
  check('assistant edit times 403', assistantEditTimes.status === 403);
  const assistantArchive = await req('POST', `/api/classrooms/${classroomId}/archive`, { headers: assistantAuth });
  check('assistant archive 403', assistantArchive.status === 403);
  const assistantAdd = await req('POST', `/api/classrooms/${classroomId}/educators`, { headers: assistantAuth, body: { email: 'priya@makers.test' } });
  check('assistant add educator 403', assistantAdd.status === 403);
  const renameRes = await req('PATCH', `/api/classrooms/${classroomId}/students/${tinyId}`, { headers: assistantAuth, body: { nickname: 'Tiny Turtle' } });
  check('assistant rename same name ok', renameRes.status === 200 && renameRes.json.nickname === 'Tiny Turtle');
  const renameTaken = await req('PATCH', `/api/classrooms/${classroomId}/students/${tinyId}`, { headers: assistantAuth, body: { nickname: 'blue fox' } });
  check('rename taken 409', renameTaken.status === 409 && renameTaken.json.error === 'nickname_taken');

  // 18. hand-in rules on the classroom
  const draftClassroom = await req('POST', '/api/classrooms', { headers: auth, body: { name: 'Future Camp', timeZone: 'America/Chicago', joinOpensLocal: '2031-01-01T09:00' } });
  check('draft classroom created', draftClassroom.status === 201 && draftClassroom.json.state === 'draft', draftClassroom.json.state);
  const draftHandIn = await req('POST', `/api/classrooms/${draftClassroom.json.id}/hand-in`, { headers: auth });
  check('draft hand-in 409', draftHandIn.status === 409 && draftHandIn.json.error === 'classroom_not_started');
  const archiveEarly = await req('POST', `/api/classrooms/${classroomId}/archive`, { headers: auth });
  check('archive not handed in 409', archiveEarly.status === 409 && archiveEarly.json.error === 'not_handed_in');

  // 19. student project hand-in
  const handIn = await req('POST', `/api/projects/${pid}/hand-in`, { headers: studentAuth });
  check('project hand-in 200', handIn.status === 200 && handIn.json.project.state === 'handed_in');
  const handInAgain = await req('POST', `/api/projects/${pid}/hand-in`, { headers: studentAuth });
  check('double hand-in 409', handInAgain.status === 409 && handInAgain.json.error === 'project_handed_in');
  const saveAfterHandIn = await req('PUT', `/api/projects/${pid}`, { headers: studentAuth, body: { baseRevision: 3, snapshot: snap } });
  check('save after hand-in 409', saveAfterHandIn.status === 409 && saveAfterHandIn.json.error === 'project_handed_in');
  const educatorHandIn = await req('POST', `/api/projects/${S.projects.find((p) => p.ownerId === S.educator.id).id}/hand-in`, { headers: auth });
  check('educator own project not classroom 409', educatorHandIn.status === 409 && educatorHandIn.json.error === 'not_a_classroom_project');

  // 20. body limits and content type
  const bigBody = JSON.stringify({ kind: '3d', name: 'x'.repeat(2_100_000), snapshot: { kind: '3d', objects: [], workplane: { origin: [0, 0, 0], normal: [0, 0, 1] } } });
  const tooLarge = await req('POST', '/api/projects', { headers: { ...auth, 'Content-Type': 'application/json' }, body: bigBody });
  check('too large 413', tooLarge.status === 413 && tooLarge.json.error === 'too_large', `${tooLarge.status}`);
  const wrongType = await req('POST', '/api/classrooms', { headers: { ...auth, 'Content-Type': 'text/plain' }, body: 'x' });
  check('wrong media 415', wrongType.status === 415 && wrongType.json.error === 'unsupported_media');

  // 21. same-origin boundary
  const foreign = await req('POST', '/api/classrooms', { headers: { ...auth, 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: { name: 'Bad', timeZone: 'America/Chicago' } });
  check('foreign origin 403', foreign.status === 403);

  // 22. grading clock
  const setClock = await req('POST', '/api/grading/clock', { headers: { 'X-Grading-Token': TOKEN }, body: { now: '2030-01-01T00:00:00Z' } });
  check('clock set', setClock.status === 200 && setClock.json.now.startsWith('2030-01-01T00:00:00'), setClock.json.now);
  const classroomAfter = await req('GET', `/api/classrooms/${classroomId}`, { headers: auth });
  check('classroom handed in by clock', classroomAfter.json.state === 'handed_in', classroomAfter.json.state);
  const joinedStudentsProjects = S.projects.filter((p) => p.kind === 'circuit' && p.ownerId === S.students[0].id);
  const tinySes = await fetch(`${BASE}/api/grading/session?user=${S.students[0].id}&token=${TOKEN}`, { redirect: 'manual' });
  const tinyCookie = tinySes.headers.get('set-cookie')?.split(';')[0];
  const saveAfterClassroomHandIn = await req('PUT', `/api/projects/${joinedStudentsProjects[0].id}`, { headers: { Cookie: tinyCookie }, body: { baseRevision: 3, snapshot: { kind: 'circuit', components: [], wires: [] } } });
  check('save in handed-in classroom 409 classroom_handed_in', saveAfterClassroomHandIn.status === 409 && saveAfterClassroomHandIn.json.error === 'classroom_handed_in', saveAfterClassroomHandIn.json?.error);
  const badClock = await req('POST', '/api/grading/clock', { headers: { 'X-Grading-Token': TOKEN }, body: { now: 'not-a-date' } });
  check('bad clock 422', badClock.status === 422);
  const resetClock = await req('POST', '/api/grading/clock', { headers: { 'X-Grading-Token': TOKEN }, body: { now: null } });
  check('clock reset', resetClock.status === 200);
  const classroomRestored = await req('GET', `/api/classrooms/${classroomId}`, { headers: auth });
  check('classroom open again', classroomRestored.json.state === 'open', classroomRestored.json.state);

  // 23. exports: build a tiny valid binary STL (84 + 50 bytes)
  const stl = Buffer.alloc(84 + 50);
  stl.write('Quarkyard', 0, 'binary');
  stl.writeUInt32LE(1, 80);
  const upload = await req('POST', `/api/exports?format=stl&unit=mm&name=gear-box.stl&projectId=${pid}`, { headers: { ...studentAuth, 'Content-Type': 'application/octet-stream' }, body: stl, raw: true });
  check('export upload 201', upload.status === 201, upload.text.slice(0, 200));
  check('export bytes', upload.json.bytes === 134);
  check('export triangleCount', upload.json.triangleCount === 1);
  const badName = await req('POST', `/api/exports?format=stl&unit=mm&name=Gear Box.stl&projectId=${pid}`, { headers: { ...studentAuth, 'Content-Type': 'application/octet-stream' }, body: stl, raw: true });
  check('bad export name 422', badName.status === 422);
  const badExt = await req('POST', `/api/exports?format=stl&unit=mm&name=gear-box.obj&projectId=${pid}`, { headers: { ...studentAuth, 'Content-Type': 'application/octet-stream' }, body: stl, raw: true });
  check('wrong extension 422', badExt.status === 422);
  const foreignProjectExport = await req('POST', `/api/exports?format=stl&unit=mm&name=x.stl&projectId=${S.projects.find((p) => p.ownerId === S.educator.id).id}`, { headers: { ...studentAuth, 'Content-Type': 'application/octet-stream' }, body: stl, raw: true });
  check('foreign project export 404', foreignProjectExport.status === 404);
  const download = await req('GET', upload.json.downloadUrl, { headers: studentAuth });
  check('download 200 bytes', download.status === 200 && download.text.length === 134);
  const educatorDownload = await req('GET', upload.json.downloadUrl, { headers: auth });
  check('educator downloads student export', educatorDownload.status === 200);
  const classroomExports = await req('GET', `/api/classrooms/${classroomId}/exports`, { headers: auth });
  check('classroom exports list', classroomExports.status === 200 && classroomExports.json.exports.length === 1, JSON.stringify(classroomExports.json).slice(0,150));

  // 24. removal — remove the joined student (owner of the created project)
  const joinedAccountId = joined.json.account.id;
  check('joined student id known', typeof joinedAccountId === 'string');
  const removeStudent = await req('DELETE', `/api/classrooms/${classroomId}/students/${joinedAccountId}`, { headers: auth });
  check('remove student 204', removeStudent.status === 204, removeStudent.text.slice(0, 100));
  const removedNext = await req('GET', '/api/session', { headers: studentAuth });
  check('removed session reports null', removedNext.status === 200 && removedNext.json.account === null && removedNext.json.pendingJoin === null);
  const removedAfter = await req('GET', '/api/class', { headers: studentAuth });
  check('removed account 401 removed', removedAfter.status === 401 && removedAfter.json.error === 'removed', removedAfter.json?.error);
  const removedProjectAsEducator = await req('GET', `/api/projects/${pid}`, { headers: auth });
  check('removed project 404 for educator', removedProjectAsEducator.status === 404 && removedProjectAsEducator.json.error === 'not_found', removedProjectAsEducator.json?.error);
  const removedExportDownload = await req('GET', upload.json.downloadUrl, { headers: studentAuth });
  check('removed export 404', removedExportDownload.status === 401);
  const nicknameFree = await req('POST', '/api/join/code', { body: { code: newCode.json.joinCode } });
  const freeNick = await req('POST', '/api/join/nickname', { headers: { Cookie: nicknameFree.headers.get('set-cookie')?.split(';')[0] }, body: { nickname: 'zoë 2' } });
  check('nickname freed after removal', freeNick.status === 201, freeNick.text.slice(0, 150));

  // 25. sign up + verify flow
  const signup = await req('POST', '/api/auth/signup', { body: { email: 'parent@example.test', password: 'long-enough-pass', displayName: 'Parent Maker', accountType: 'personal' } });
  check('signup 201', signup.status === 201, signup.text.slice(0, 200));
  check('signup sent email', signup.json.verificationEmailSent === true);
  const signupCookie = signup.headers.get('set-cookie')?.split(';')[0];
  const dupEmail = await req('POST', '/api/auth/signup', { body: { email: 'PARENT@example.test', password: 'long-enough-pass', displayName: 'Dup', accountType: 'personal' } });
  check('email taken case-insensitive 409', dupEmail.status === 409 && dupEmail.json.error === 'email_taken');
  const shortPass = await req('POST', '/api/auth/signup', { body: { email: 'a@b.co', password: 'short', displayName: 'A', accountType: 'personal' } });
  check('password short 422', shortPass.status === 422 && shortPass.json.fields?.password === 'Use at least 10 characters.');
  const badEmail = await req('POST', '/api/auth/signup', { body: { email: 'nodomain', password: 'long-enough-pass', displayName: 'A', accountType: 'personal' } });
  check('email invalid 422', badEmail.status === 422 && badEmail.json.fields?.email === 'Enter a valid email address.');
  const badCreds = await req('POST', '/api/auth/signin', { body: { email: 'parent@example.test', password: 'wrong-password' } });
  check('bad credentials 401', badCreds.status === 401 && badCreds.json.error === 'bad_credentials');
  const goodCreds = await req('POST', '/api/auth/signin', { body: { email: 'PARENT@example.test', password: 'long-enough-pass' } });
  check('signin ok', goodCreds.status === 200 && goodCreds.json.account.email === 'parent@example.test');

  // fetch the token from Mailpit
  const mp = await fetch('http://mailpit:8025/api/v1/messages?limit=5');
  const messages = await mp.json();
  const ours = messages.messages?.find((m) => m.Subject === 'Verify your Quarkyard email');
  check('mailpit has message', Boolean(ours));
  const msg = await fetch(`http://mailpit:8025/api/v1/message/${ours.ID}`);
  const msgData = await msg.json();
  const link = (msgData.Text?.match(/token=([a-f0-9]+)/) ?? [])[1];
  check('verification link token', Boolean(link));
  const verify = await req('POST', '/api/auth/verify', { body: { token: link } });
  check('verify 200', verify.status === 200 && verify.json.account.emailVerified === true);
  const verifyAgain = await req('POST', '/api/auth/verify', { body: { token: link } });
  check('verify again 410', verifyAgain.status === 410 && verifyAgain.json.error === 'link_expired');
  const canSave = await req('POST', '/api/projects', { headers: { Cookie: signupCookie }, body: { kind: '3d', name: 'Home Part', snapshot: snap } });
  check('verified can create', canSave.status === 201);

  // 26. config endpoint
  const config = await req('GET', '/api/config');
  check('config keys', config.status === 200 && typeof config.json.autosaveMs === 'number' && typeof config.json.glancetFadeMs === 'number');

  // 27. stream auth
  const streamNoAuth = await req('GET', '/api/stream');
  check('stream no auth 401', streamNoAuth.status === 401);
  const streamPending = await fetch(BASE + '/api/stream', { headers: pendingAuth });
  check('stream pending 401', streamPending.status === 401);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
