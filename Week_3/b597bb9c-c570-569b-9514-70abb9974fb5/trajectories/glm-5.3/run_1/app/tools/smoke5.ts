/* Smoke test 5: outage behaviour. Run a server with unreachable MinIO and
   RabbitMQ on port 4299, then check the published 503 answers and that
   health still says ok. */
const BASE = 'http://127.0.0.1:4299';
let failures = 0;

function check(name, ok, extra): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra ?? ''}`); }
}

async function call(method, path, body, jar): Promise<{ status: number, json?: Record<string, unknown>, text: string, headers: Headers }> {
  const headers: Record<string, string> = {};
  if (jar !== undefined) headers.cookie = jar;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function main(): Promise<void> {
  // Health answers ok even with storage and queue unreachable.
  const health = await call('GET', '/api/health', undefined, undefined);
  check('health ok during outage', health.status === 200 && health.json?.status === 'ok', JSON.stringify(health.json));

  const signin = await call('POST', '/api/session', { email: 'noor@gatecut.example', password: 'reel-owner-4417' }, undefined);
  check('sign in works during outage', signin.status === 200, `${signin.status}`);
  const jar = signin.headers.get('set-cookie')?.split(';')[0] ?? '';

  // Reads from Postgres keep working.
  const projects = await call('GET', '/api/projects', undefined, jar);
  check('project list still works', projects.status === 200 && projects.json?.items?.length === 8, `${projects.status}`);

  // The owner status endpoint reports the outage.
  const status = await call('GET', '/api/status', undefined, jar);
  check('status reports storage down', status.json?.storage === 'down', JSON.stringify(status.json));
  check('status reports queue down', status.json?.queue === 'down', JSON.stringify(status.json));

  // Uploads answer 503 with the published copy.
  const upload = await call('POST', '/api/uploads', { file_name: 'x.wav', bytes: 100, sha256: 'a'.repeat(64), folder: 'Rushes' }, jar);
  check('upload create 503 storage_unavailable', upload.status === 503 && upload.json?.error === 'storage_unavailable', `${upload.status} ${JSON.stringify(upload.json)}`);
  check('503 copy is the published one', upload.json?.message === 'Media storage is unreachable. Uploads and exports are paused; nothing was saved.', JSON.stringify(upload.json?.message));

  // Exports answer 503 with the published copy and take no minutes. A fresh
  // cut is used so the repeated-request rule cannot answer 200 first.
  const freshCut = await call('POST', '/api/projects/harbour-light/cuts', { name: 'Outage cut' }, jar);
  check('name a fresh cut', freshCut.status === 201, `${freshCut.status}`);
  const before = await call('GET', '/api/allowance', undefined, jar);
  const exportStart = await call('POST', '/api/projects/harbour-light/exports', { cut_id: freshCut.json?.id, size: 1080 }, jar);
  check('export start 503 queue_unavailable', exportStart.status === 503 && exportStart.json?.error === 'queue_unavailable', `${exportStart.status} ${JSON.stringify(exportStart.json)}`);
  check('queue 503 copy is the published one', exportStart.json?.message === 'The export queue is unreachable. No export was started and no minutes were used.', JSON.stringify(exportStart.json?.message));
  const after = await call('GET', '/api/allowance', undefined, jar);
  check('no minutes were taken', after.json?.export_minutes_used === before.json?.export_minutes_used, `${before.json?.export_minutes_used} -> ${after.json?.export_minutes_used}`);
  const exportsList = await call('GET', '/api/projects/harbour-light/exports', undefined, jar);
  check('nothing was queued', (exportsList.json?.items ?? []).every((e: { cut_id: string }) => e.cut_id !== freshCut.json?.id), JSON.stringify(exportsList.json?.items?.length));

  // The boundary still runs first: a 404 answers before the outage.
  const missing = await call('GET', '/api/nope', undefined, jar);
  check('404 before outage', missing.status === 404, `${missing.status}`);
  const badRole = await call('POST', '/api/projects/harbour-light/exports', { cut_id: 'hl-cut-1', size: 1080 }, undefined);
  check('401 before outage', badRole.status === 401, `${badRole.status}`);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
}

void main();
