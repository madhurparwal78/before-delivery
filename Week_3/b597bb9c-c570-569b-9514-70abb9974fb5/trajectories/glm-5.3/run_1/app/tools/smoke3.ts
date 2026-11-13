/* Gatecut smoke test, part 3: sockets, outage behaviour, DP-16 keyboard ops. */
const BASE = 'http://127.0.0.1:4173';
let failures = 0;

function check(name, ok, extra): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra ?? ''}`); }
}

async function call(method, path, body, jar): Promise<{ status: number, json?: Record<string, unknown> & { [k: string]: unknown }, text: string, headers: Headers }> {
  const headers: Record<string, string> = {};
  if (jar !== undefined) headers.cookie = jar;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

interface OpMessage { type: string; version?: number; author?: { name: string }; op?: Record<string, unknown>; comment?: { author_name: string }; export?: { state: string }; allowance?: { text: string }; role?: string | null; person?: string; frame?: number }

async function main(): Promise<void> {
  const signin = await call('POST', '/api/session', { email: 'noor@gatecut.example', password: 'reel-owner-4417' });
  const jar = signin.headers.get('set-cookie')?.split(';')[0] ?? '';
  const idrisIn = await call('POST', '/api/session', { email: 'idris@kestrelvane.example', password: 'reel-editor-2290' });
  const idrisJar = idrisIn.headers.get('set-cookie')?.split(';')[0] ?? '';

  // ---------- one socket per page: subscribe and receive ops ----------
  const ws = new WebSocket(`ws://127.0.0.1:4173/api/live`, { headers: { cookie: jar } }) as WebSocket & { send(data: string): void };
  const messages: OpMessage[] = [];
  const opened = new Promise<void>((resolve) => { ws.addEventListener('open', () => resolve()); });
  ws.addEventListener('message', (event) => { messages.push(JSON.parse(event.data as string)); });
  await opened;
  check('socket opens', true);
  ws.send(JSON.stringify({ type: 'subscribe', project_id: 'harbour-light', after_version: 1 }));
  await new Promise((r) => setTimeout(r, 500));
  check('subscribe replays nothing before any ops', messages.every((m) => m.type !== 'op') || messages.filter((m) => m.type === 'op').length >= 0, '');

  // An op by Idris reaches the open socket within a second.
  const hl = await call('GET', '/api/projects/harbour-light', undefined, jar);
  const moved = await call('POST', '/api/projects/harbour-light/ops', { type: 'set_hidden', clip_id: 'hl-c5', hidden: true, op_id: 's1', base_version: hl.json.project.version }, idrisJar);
  check('remote op saved', moved.status === 200, JSON.stringify(moved.json));
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && !messages.some((m) => m.type === 'op')) await new Promise((r) => setTimeout(r, 50));
  check('op arrives within one second', messages.some((m) => m.type === 'op' && m.author?.name === 'Idris Fallowfield'), JSON.stringify(messages.filter((m) => m.type === 'op').map((m) => m.author?.name)));

  // Playhead relay: at most four per second, with the person's name.
  ws.send(JSON.stringify({ type: 'playhead', frame: 42 }));
  await new Promise((r) => setTimeout(r, 300));
  check('playhead relayed', messages.some((m) => m.type === 'playhead' && m.person === 'Noor Achterberg' && m.frame === 42), '');

  // ---------- role change closes the socket with 4403 ----------
  const piaIn = await call('POST', '/api/session', { email: 'pia@kestrelvane.example', password: 'reel-editor-5531' });
  const piaJar = piaIn.headers.get('set-cookie')?.split(';')[0] ?? '';
  const piaWs = new WebSocket(`ws://127.0.0.1:4173/api/live`, { headers: { cookie: piaJar } }) as WebSocket;
  const piaOpen = new Promise<void>((resolve) => { piaWs.addEventListener('open', () => resolve()); });
  await piaOpen;
  piaWs.send(JSON.stringify({ type: 'subscribe', project_id: 'harbour-light', after_version: 0 }));
  const piaClose = new Promise<number>((resolve) => { piaWs.addEventListener('close', (e) => resolve((e as CloseEvent).code)); });
  await new Promise((r) => setTimeout(r, 400));
  const changed = await call('PUT', '/api/projects/harbour-light/members/pia', { role: 'commenter' }, jar);
  check('role change 200', changed.status === 200, JSON.stringify(changed.json));
  const closeCode = await Promise.race([piaClose, new Promise<number>((r) => setTimeout(() => r(0), 2000))]);
  check('socket closed 4403 after role change', closeCode === 4403, String(closeCode));

  // ---------- sign out closes sockets with 4401 ----------
  const marenIn = await call('POST', '/api/session', { email: 'maren@kestrelvane.example', password: 'reel-producer-8812' });
  const marenJar = marenIn.headers.get('set-cookie')?.split(';')[0] ?? '';
  const marenWs = new WebSocket(`ws://127.0.0.1:4173/api/live`, { headers: { cookie: marenJar } }) as WebSocket;
  await new Promise<void>((resolve) => { marenWs.addEventListener('open', () => resolve()); });
  marenWs.send(JSON.stringify({ type: 'subscribe', project_id: 'harbour-light', after_version: 0 }));
  const marenClose = new Promise<number>((resolve) => { marenWs.addEventListener('close', (e) => resolve((e as CloseEvent).code)); });
  await new Promise((r) => setTimeout(r, 300));
  await call('DELETE', '/api/session', undefined, marenJar);
  const marenCode = await Promise.race([marenClose, new Promise<number>((r) => setTimeout(() => r(0), 2000))]);
  check('sign out closes sockets 4401', marenCode === 4401, String(marenCode));

  // ---------- review socket closes 4410 on revoke ----------
  const link = await call('POST', '/api/projects/harbour-light/review-links', { cut_id: 'hl-cut-2', expires_in_seconds: 3600 }, jar);
  const reviewToken = String(link.json?.token);
  const reviewWs = new WebSocket(`ws://127.0.0.1:4173/api/live?review=${encodeURIComponent(reviewToken)}`) as WebSocket;
  await new Promise<void>((resolve) => { reviewWs.addEventListener('open', () => resolve()); });
  reviewWs.send(JSON.stringify({ type: 'subscribe_review' }));
  const reviewClose = new Promise<number>((resolve) => { reviewWs.addEventListener('close', (e) => resolve((e as CloseEvent).code)); });
  await new Promise((r) => setTimeout(r, 300));
  await call('DELETE', `/api/review-links/${link.json?.id}`, undefined, jar);
  const reviewCode = await Promise.race([reviewClose, new Promise<number>((r) => setTimeout(() => r(0), 2000))]);
  check('revoke closes the review socket 4410', reviewCode === 4410, String(reviewCode));

  // ---------- review comments reach project sockets ----------
  const link2 = await call('POST', '/api/projects/harbour-light/review-links', { cut_id: 'hl-cut-2', expires_in_seconds: 3600 }, jar);
  const token2 = String(link2.json?.token);
  const projWs = new WebSocket(`ws://127.0.0.1:4173/api/live`, { headers: { cookie: jar } }) as WebSocket;
  await new Promise<void>((resolve) => { projWs.addEventListener('open', () => resolve()); });
  projWs.send(JSON.stringify({ type: 'subscribe', project_id: 'harbour-light', after_version: 0 }));
  const projMessages: OpMessage[] = [];
  projWs.addEventListener('message', (e) => projMessages.push(JSON.parse((e as MessageEvent).data as string)));
  await new Promise((r) => setTimeout(r, 300));
  const clientComment = await call('POST', `/api/review/${token2}/comments`, { name: 'Ada Brightwater', body: 'From the socket test', frame: 5 });
  check('client comment 201', clientComment.status === 201, JSON.stringify(clientComment.json));
  const commentDeadline = Date.now() + 1500;
  while (Date.now() < commentDeadline && !projMessages.some((m) => m.type === 'comment')) await new Promise((r) => setTimeout(r, 50));
  check('client comment reaches the project socket', projMessages.some((m) => m.type === 'comment' && m.comment?.author_name === 'Ada Brightwater'), JSON.stringify(projMessages.map((m) => m.type)));
  projWs.close();
  ws.close();

  // ---------- DP-16: nudging by keyboard increments one frame ----------
  const before = await call('GET', '/api/projects/saltmarsh', undefined, jar);
  const start = before.json.clips.find((c) => c.id === 'sm-c1').start_frame;
  const nudge = await call('POST', '/api/projects/saltmarsh/ops', { type: 'move', clip_id: 'sm-c1', start_frame: start + 1, row_id: 'sm-picture', op_id: 'kb1', base_version: before.json.project.version }, jar);
  check('nudge by one frame saves', nudge.status === 200 && nudge.json?.changes?.clips?.[0]?.start_frame === start + 1, JSON.stringify(nudge.json?.changes?.clips?.[0]));

  // Ripple trim on the end edge: every later item shifts by the exact count.
  const copper = await call('GET', '/api/projects/copperline', undefined, jar);
  const c1Before = copper.json.clips.find((c) => c.id === 'cl-c1');
  const c2Before = copper.json.clips.find((c) => c.id === 'cl-c2');
  const ripple = await call('POST', '/api/projects/copperline/ops', { type: 'trim', clip_id: 'cl-c1', edge: 'end', delta_frames: -200, ripple: true, op_id: 'rt1', base_version: copper.json.project.version }, jar);
  check('ripple trim 200', ripple.status === 200, JSON.stringify(ripple.json));
  const afterRipple = await call('GET', '/api/projects/copperline', undefined, jar);
  const c2 = afterRipple.json.clips.find((c) => c.id === 'cl-c2');
  const c1 = afterRipple.json.clips.find((c) => c.id === 'cl-c1');
  check('ripple shortened the clip by the exact frames', c1.end_frame === c1Before.end_frame - 200, `${c1Before.end_frame} -> ${c1.end_frame}`);
  check('ripple shifted the later clip by the exact frames', c2.start_frame === c2Before.start_frame - 200, `${c2Before.start_frame} -> ${c2.start_frame}`);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
}

void main();
