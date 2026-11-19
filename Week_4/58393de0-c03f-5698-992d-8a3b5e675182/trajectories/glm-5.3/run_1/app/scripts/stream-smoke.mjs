// SSE stream smoke test: verifies event delivery for roster joins, saves,
// hand-in, classroom-state and access-ended.
const BASE = 'http://127.0.0.1:4173';
const TOKEN = 'qy-grading-local';
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

async function main() {
  const seed = await (await fetch(`${BASE}/api/grading/seed`, { method: 'POST', headers: { 'X-Grading-Token': TOKEN } })).json();
  const eduSes = await fetch(`${BASE}/api/grading/session?user=${seed.educator.id}&token=${TOKEN}`, { redirect: 'manual' });
  const eduCookie = eduSes.headers.get('set-cookie').split(';')[0];

  // Open the educator stream.
  const streamRes = await fetch(`${BASE}/api/stream`, { headers: { Cookie: eduCookie } });
  check('stream 200', streamRes.status === 200);
  check('stream content type', (streamRes.headers.get('content-type') ?? '').includes('text/event-stream'));

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  const waitFor = (name, timeoutMs = 4000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const found = events.find((e) => e.event === name);
      if (found) { resolve(found.data); return; }
      if (Date.now() - started > timeoutMs) { reject(new Error(`timeout waiting for ${name}`)); return; }
      setTimeout(poll, 50);
    };
    poll();
  });

  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = '';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (event && data) { try { events.push({ event, data: JSON.parse(data) }); } catch { /* keep */ } }
      }
    }
  })();

  // Trigger a join.
  const code = await fetch(`${BASE}/api/join/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: seed.classroom.joinCode }) });
  const joinCookie = code.headers.get('set-cookie').split(';')[0];
  const joined = await (await fetch(`${BASE}/api/join/nickname`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: joinCookie }, body: JSON.stringify({ nickname: 'Stream Kid' }) })).json();
  const joinedCookie = (await fetch(`${BASE}/api/grading/session?user=${joined.account.id}&token=${TOKEN}`, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const joinData = await waitFor('student-joined');
  check('student-joined event', joinData.student?.nickname === 'Stream Kid', JSON.stringify(joinData));

  // Trigger a save.
  const snap = { kind: '3d', objects: [], workplane: { origin: [0, 0, 0], normal: [0, 0, 1] } };
  const created = await (await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: joinedCookie }, body: JSON.stringify({ kind: '3d', name: 'Stream Part', snapshot: snap }) })).json();
  const saveData = await waitFor('project-saved');
  check('project-saved event', saveData.projectId === created.project.id, JSON.stringify(saveData));

  // Trigger a student hand-in.
  await fetch(`${BASE}/api/projects/${created.project.id}/hand-in`, { method: 'POST', headers: { Cookie: joinedCookie } });
  const handInData = await waitFor('project-handed-in');
  check('project-handed-in event', handInData.projectId === created.project.id);

  // Trigger a classroom-state via clock.
  await fetch(`${BASE}/api/grading/clock`, { method: 'POST', headers: { 'X-Grading-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ now: '2031-01-01T00:00:00Z' }) });
  const stateData = await waitFor('classroom-state');
  check('classroom-state event', stateData.state === 'handed_in', JSON.stringify(stateData));
  await fetch(`${BASE}/api/grading/clock`, { method: 'POST', headers: { 'X-Grading-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ now: null }) });

  // Trigger a removal (access-ended for the student stream + student-removed for the educator).
  const studentStreamRes = await fetch(`${BASE}/api/stream`, { headers: { Cookie: joinedCookie } });
  const studentReader = studentStreamRes.body.getReader();
  const studentEvents = [];
  let sBuffer = '';
  void (async () => {
    while (true) {
      const { done, value } = await studentReader.read();
      if (done) break;
      sBuffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = sBuffer.indexOf('\n\n')) !== -1) {
        const block = sBuffer.slice(0, idx);
        sBuffer = sBuffer.slice(idx + 2);
        let event = '';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (event && data) { try { studentEvents.push({ event, data: JSON.parse(data) }); } catch { /* keep */ } }
      }
    }
  })();

  const removed = await fetch(`${BASE}/api/classrooms/${seed.classroom.id}/students/${joined.account.id}`, { method: 'DELETE', headers: { Cookie: eduCookie } });
  check('remove 204', removed.status === 204);
  const removedEvent = await waitFor('student-removed');
  check('student-removed event', removedEvent.nickname === 'Stream Kid');

  // The student stream should get access-ended and close.
  await new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (studentEvents.some((e) => e.event === 'access-ended')) { resolve(); return; }
      if (Date.now() - started > 4000) { reject(new Error('timeout waiting for access-ended')); return; }
      setTimeout(poll, 50);
    };
    poll();
  }).then(() => check('student access-ended event', true), () => check('student access-ended event', false));

  reader.cancel().catch(() => undefined);
  console.log(failures === 0 ? '\nSTREAM PASS' : `\n${failures} STREAM FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
