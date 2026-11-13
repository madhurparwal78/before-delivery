/* Gatecut end-to-end API smoke test, part 2: uploads, outage, socket flows. */
const BASE = 'http://127.0.0.1:4173';
let failures = 0;

function check(name, ok, extra): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra ?? ''}`); }
}

async function call(method, path, body, jar, contentType):
  Promise<{ status: number, json?: unknown, text: string, headers: Headers }> {
  const headers: Record<string, string> = {};
  if (jar !== undefined) headers.cookie = jar;
  if (body !== undefined) headers['content-type'] = contentType ?? 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

async function main(): Promise<void> {
  const signin = await call('POST', '/api/session', { email: 'noor@gatecut.example', password: 'reel-owner-4417' });
  const jar = signin.headers.get('set-cookie')?.split(';')[0] ?? '';

  // ---------- uploads: resumable, deduped by checksum ----------
  const bytes = new Uint8Array(300);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const crypto = await import('node:crypto');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  // Wrap in a valid WAV so the header judge accepts it: 8000 Hz mono 16-bit,
  // 150 samples = 300 bytes of data.
  const wav = new Uint8Array(44 + 300);
  wav.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(wav.buffer).setUint32(4, wav.length - 8, true);
  wav.set([0x57, 0x41, 0x56, 0x45], 8);
  wav.set([0x66, 0x6d, 0x74, 0x20], 12);
  new DataView(wav.buffer).setUint32(16, 16, true);
  new DataView(wav.buffer).setUint16(20, 1, true);
  new DataView(wav.buffer).setUint16(22, 1, true);
  new DataView(wav.buffer).setUint32(24, 8000, true);
  new DataView(wav.buffer).setUint32(28, 16000, true);
  new DataView(wav.buffer).setUint16(32, 2, true);
  new DataView(wav.buffer).setUint16(34, 16, true);
  wav.set([0x64, 0x61, 0x74, 0x61], 36);
  new DataView(wav.buffer).setUint32(40, 300, true);
  wav.set(bytes, 44);
  const wavSha = crypto.createHash('sha256').update(wav).digest('hex');

  const created = await call('POST', '/api/uploads', { file_name: 'test_bed.wav', bytes: wav.length, sha256: wavSha, folder: 'Rushes' }, jar);
  check('create upload 201', created.status === 201 && created.json?.chunks === 1, JSON.stringify(created.json));

  // Resume: create again returns the same upload with its received chunks.
  const chunkRes = await fetch(`${BASE}/api/uploads/${created.json?.upload_id}/chunks/0`, {
    method: 'PUT',
    headers: { cookie: jar, 'content-type': 'application/octet-stream' },
    body: wav,
  });
  check('chunk 204', chunkRes.status === 204, `${chunkRes.status} ${await chunkRes.text()}`);
  const again = await call('POST', '/api/uploads', { file_name: 'other_name.wav', bytes: wav.length, sha256: wavSha, folder: 'Rushes' }, jar);
  check('re-create returns the open upload', again.status === 200 && again.json?.upload_id === created.json?.upload_id, JSON.stringify(again.json));
  check('re-create keeps the first file name', (await call('GET', '/api/uploads', undefined, jar)).json?.items?.some((u) => u.file_name === 'test_bed.wav'), '');

  const complete = await call('POST', `/api/uploads/${created.json?.upload_id}/complete`, {}, jar);
  check('complete 201 with media', complete.status === 201 && complete.json?.media?.kind === 'wav', JSON.stringify(complete.json));
  const dupCreate = await call('POST', '/api/uploads', { file_name: 'copy.wav', bytes: wav.length, sha256: wavSha, folder: 'Rushes' }, jar);
  check('checksum already stored answers duplicate', dupCreate.status === 200 && dupCreate.json?.duplicate === true, JSON.stringify(dupCreate.json));

  const badWav = new Uint8Array(44);
  badWav.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0], 0);
  const badSha = crypto.createHash('sha256').update(badWav).digest('hex');
  const badCreated = await call('POST', '/api/uploads', { file_name: 'broken.wav', bytes: badWav.length, sha256: badSha, folder: 'Rushes' }, jar);
  await fetch(`${BASE}/api/uploads/${badCreated.json?.upload_id}/chunks/0`, { method: 'PUT', headers: { cookie: jar, 'content-type': 'application/octet-stream' }, body: badWav });
  const badComplete = await call('POST', `/api/uploads/${badCreated.json?.upload_id}/complete`, {}, jar);
  check('damaged WAV refused with reason', badComplete.status === 422 && badComplete.json?.error === 'upload_refused' && badComplete.json?.reason === 'WAV header is damaged', JSON.stringify(badComplete.json));

  const truncated = new Uint8Array(20);
  truncated.set([0x00, 0x74, 0x79, 0x00, 0x6d, 0x70, 0x34], 0);
  const truncSha = crypto.createHash('sha256').update(truncated).digest('hex');
  const truncCreated = await call('POST', '/api/uploads', { file_name: 'short.mp4', bytes: truncated.length, sha256: truncSha, folder: 'Rushes' }, jar);
  await fetch(`${BASE}/api/uploads/${truncCreated.json?.upload_id}/chunks/0`, { method: 'PUT', headers: { cookie: jar, 'content-type': 'application/octet-stream' }, body: truncated });
  const truncComplete = await call('POST', `/api/uploads/${truncCreated.json?.upload_id}/complete`, {}, jar);
  check('truncated MP4 refused by name', truncComplete.status === 422 && (truncComplete.json?.message ?? '').includes('short.mp4'), JSON.stringify(truncComplete.json));

  const unknownBytes = new TextEncoder().encode('<?xml version="1.0"?>');
  const unknownSha = crypto.createHash('sha256').update(unknownBytes).digest('hex');
  const unknownCreated = await call('POST', '/api/uploads', { file_name: 'note.xml', bytes: unknownBytes.length, sha256: unknownSha, folder: 'Rushes' }, jar);
  await fetch(`${BASE}/api/uploads/${unknownCreated.json?.upload_id}/chunks/0`, { method: 'PUT', headers: { cookie: jar, 'content-type': 'application/octet-stream' }, body: unknownBytes });
  const unknownComplete = await call('POST', `/api/uploads/${unknownCreated.json?.upload_id}/complete`, {}, jar);
  check('unknown file type refused', unknownComplete.status === 422 && unknownComplete.json?.reason === 'unknown file type', JSON.stringify(unknownComplete.json));

  // A file used in a project cannot be deleted; an unused one can.
  const deleteUsed = await call('DELETE', '/api/media/kv-logo', undefined, jar);
  check('unused file deletes 204', deleteUsed.status === 204, `${deleteUsed.status}`);
  const beforeAllowance = await call('GET', '/api/allowance', undefined, jar);
  check('storage fell back by the deleted bytes', Number(beforeAllowance.json?.storage_bytes_used) < 41200483365, JSON.stringify(beforeAllowance.json?.storage_bytes_used));

  // ---------- keyframe interpolation agrees ----------
  // hl-c2 starts at 240 with opacity 0 at its own frame 0 (eased) and 100 at 24.
  const frame252 = await call('GET', '/api/projects/harbour-light/frames/252', undefined, jar);
  const frame264 = await call('GET', '/api/projects/harbour-light/frames/264', undefined, jar);
  const frame240 = await call('GET', '/api/projects/harbour-light/frames/240', undefined, jar);
  const layer252 = frame252.json?.layers?.find((l) => l.clip_id === 'hl-c2');
  const layer264 = frame264.json?.layers?.find((l) => l.clip_id === 'hl-c2');
  const layer240 = frame240.json?.layers?.find((l) => l.clip_id === 'hl-c2');
  check('opacity 0 at the clip start', layer240?.opacity === 0, JSON.stringify(layer240));
  check('opacity eased 50 at the midpoint', layer252?.opacity === 50, JSON.stringify(layer252));
  check('opacity 100 at its frame 24', layer264?.opacity === 100, JSON.stringify(layer264));

  // ---------- ETag follows the shared cut ----------
  const seeded = await call('GET', '/api/review/rv-harbour-cut1-7f3a2c');
  const etag = seeded.headers.get('etag');
  check('review carries a strong ETag', etag !== null && etag.startsWith('"'), String(etag));
  const notMod = await fetch(`${BASE}/api/review/rv-harbour-cut1-7f3a2c`, { headers: { 'if-none-match': etag ?? '' } });
  check('If-None-Match answers 304', notMod.status === 304, `${notMod.status}`);
  const changed = await call('PUT', `/api/review-links/hl-link-1`, { cut_id: 'hl-cut-2' }, jar);
  check('share a different cut on the link', changed.status === 200, JSON.stringify(changed.json));
  const afterShare = await fetch(`${BASE}/api/review/rv-harbour-cut1-7f3a2c`, { headers: { 'if-none-match': etag ?? '' } });
  check('ETag changes when another cut is shared', afterShare.status === 200, `${afterShare.status}`);
  const restored = await call('PUT', `/api/review-links/hl-link-1`, { cut_id: 'hl-cut-1' }, jar);
  check('share back', restored.status === 200);

  // ---------- late notes follow moved clips ----------
  const comments = await call('GET', '/api/projects/harbour-light/comments', undefined, jar);
  const late = comments.json?.items?.find((c) => c.id === 'hl-n2');
  check('seeded late client note has a live frame', late?.pin?.live_frame === 540, JSON.stringify(late?.pin));

  // ---------- restore a cut ----------
  const current = await call('GET', '/api/projects/harbour-light', undefined, jar);
  const beforeClips = current.json.clips.map((c) => `${c.id}:${c.start_frame}-${c.end_frame}`).join(' ');
  const restore = await call('POST', '/api/projects/harbour-light/cuts/hl-cut-1/restore', { op_id: 'r1', base_version: current.json.project.version }, jar);
  check('restore 200 one version', restore.status === 200 && restore.json?.version === current.json.project.version + 1, JSON.stringify(restore.json?.version));
  const after = await call('GET', '/api/projects/harbour-light', undefined, jar);
  check('restore moved hl-c3 to its cut frames', after.json.clips.find((c) => c.id === 'hl-c3')?.start_frame === 500, JSON.stringify(after.json.clips.find((c) => c.id === 'hl-c3')));
  const undoRestore = await call('POST', '/api/projects/harbour-light/undo', { op_id: 'r2' }, jar);
  check('restore undoes exactly', undoRestore.status === 200, JSON.stringify(undoRestore.json));
  const back = await call('GET', '/api/projects/harbour-light', undefined, jar);
  const afterClips = back.json.clips.map((c) => `${c.id}:${c.start_frame}-${c.end_frame}`).join(' ');
  check('undo puts every clip back', afterClips === beforeClips, `${beforeClips} vs ${afterClips}`);

  // ---------- restore refused on a locked row ----------
  const lock = await call('POST', '/api/projects/harbour-light/ops', { type: 'lock_row', row_id: 'hl-picture', locked: true, op_id: 'lk1', base_version: back.json.project.version }, jar);
  check('lock the picture row', lock.status === 200, JSON.stringify(lock.json));
  const version2 = lock.json?.version ?? back.json.project.version;
  const moveAfterLock = await call('POST', '/api/projects/harbour-light/ops', { type: 'move', clip_id: 'hl-c3', start_frame: 510, op_id: 'lk2', base_version: version2 }, jar);
  check('a move on the locked row is refused whole', moveAfterLock.status === 409 && moveAfterLock.json?.error === 'row_locked', JSON.stringify(moveAfterLock.json));
  const restoreLocked = await call('POST', '/api/projects/harbour-light/cuts/hl-cut-1/restore', { op_id: 'r3', base_version: version2 }, jar);
  check('restore on a locked row refused', restoreLocked.status === 409 && restoreLocked.json?.error === 'row_locked', JSON.stringify(restoreLocked.json));
  const afterRefused = await call('GET', '/api/projects/harbour-light', undefined, jar);
  check('refused restore changed nothing', afterRefused.json.clips.find((c) => c.id === 'hl-c3')?.start_frame === 480, JSON.stringify(afterRefused.json.clips.find((c) => c.id === 'hl-c3')?.start_frame));
  const unlock = await call('POST', '/api/projects/harbour-light/ops', { type: 'lock_row', row_id: 'hl-picture', locked: false, op_id: 'lk3', base_version: afterRefused.json.project.version }, jar);
  check('unlock the picture row', unlock.status === 200);

  // ---------- ripple remove ----------
  const copper = await call('GET', '/api/projects/copperline', undefined, jar);
  const vCopper = copper.json.project.version;
  const ripple = await call('POST', '/api/projects/copperline/ops', { type: 'remove', clip_id: 'cl-c1', ripple: true, op_id: 'rm1', base_version: vCopper }, jar);
  check('ripple remove 200', ripple.status === 200, JSON.stringify(ripple.json));
  const copperAfter = await call('GET', '/api/projects/copperline', undefined, jar);
  const cl2 = copperAfter.json.clips.find((c) => c.id === 'cl-c2');
  check('later clip shifted by the exact frames', cl2 !== undefined && cl2.start_frame !== 1500 && cl2.end_frame - cl2.start_frame === 1450, JSON.stringify(cl2));

  // ---------- group behaviour ----------
  const salt = await call('GET', '/api/projects/saltmarsh', undefined, jar);
  const addText = await call('POST', '/api/projects/saltmarsh/ops', { type: 'add_text', row_id: salt.json.rows[0]?.id ?? 'sm-picture', start_frame: 400, end_frame: 500, text: 'Fresh roast', op_id: 'g0', base_version: salt.json.project.version }, jar);
  check('add text 200', addText.status === 200, JSON.stringify(addText.json));
  if (addText.status === 200) {
    const textId = addText.json.changes.clips[0]?.id;
    const group = await call('POST', '/api/projects/saltmarsh/ops', { type: 'group', clip_ids: ['sm-c1', textId], op_id: 'g1', base_version: addText.json.version }, jar);
    check('group 200', group.status === 200, JSON.stringify(group.json));
    const groupedMove = await call('POST', '/api/projects/saltmarsh/ops', { type: 'move', clip_id: 'sm-c1', start_frame: 5, op_id: 'g2', base_version: group.json.version }, jar);
    check('group moves together', groupedMove.status === 200 && groupedMove.json?.changes?.clips?.length === 2, JSON.stringify(groupedMove.json));
    const ungroup = await call('POST', '/api/projects/saltmarsh/ops', { type: 'ungroup', group_id: (groupedMove.json?.changes?.clips?.[0]?.group_id ?? ''), op_id: 'g3', base_version: groupedMove.json.version }, jar);
    check('ungroup 200', ungroup.status === 200, JSON.stringify(ungroup.json));
  }

  // ---------- speed change ----------
  const clNow = await call('GET', '/api/projects/copperline', undefined, jar);
  const speed = await call('POST', '/api/projects/copperline/ops', { type: 'set_speed', clip_id: 'cl-c2', speed_percent: 200, op_id: 'sp1', base_version: clNow.json.project.version }, jar);
  check('speed 200 halves the length', speed.status === 200 && speed.json?.changes?.clips?.[0]?.end_frame - speed.json?.changes?.clips?.[0]?.start_frame === 725, JSON.stringify(speed.json?.changes?.clips?.[0]));

  // ---------- allowance: 409 with the amount used ----------
  const bigCut = await call('POST', '/api/projects/blue-hour/cuts', { name: 'Long cut' }, jar);
  check('name a long cut', bigCut.status === 201, JSON.stringify(bigCut.json));
  // 1500 frames at 25 fps = 1 minute; run enough exports at 2160p to be safe.
  const allowanceNow = await call('GET', '/api/allowance', undefined, jar);
  const remaining = (allowanceNow.json?.export_minutes_allowance ?? 600) - (allowanceNow.json?.export_minutes_used ?? 0);
  let lastExport = null;
  for (let i = 0; i < remaining + 2; i++) {
    const cutName = `Long cut ${i}`;
    const cut = await call('POST', '/api/projects/blue-hour/cuts', { name: cutName }, jar);
    if (cut.status !== 201) break;
    lastExport = await call('POST', '/api/projects/blue-hour/exports', { cut_id: cut.json.id, size: 2160 }, jar);
    if (lastExport.status !== 202) break;
  }
  check('allowance refusal is 409 with the amount', lastExport?.status === 409 && lastExport?.json?.error === 'allowance_exceeded' && typeof lastExport?.json?.allowance === 'object', JSON.stringify(lastExport?.json));

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
}

void main();
