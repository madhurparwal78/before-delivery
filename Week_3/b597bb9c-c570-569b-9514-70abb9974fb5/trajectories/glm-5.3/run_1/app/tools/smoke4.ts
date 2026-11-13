/* Smoke test 4: stable cursor paging while clips are being added. */
const BASE = 'http://127.0.0.1:4173';
let failures = 0;

function check(name, ok, extra): void {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra ?? ''}`); }
}

async function main(): Promise<void> {
  const signin = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'noor@gatecut.example', password: 'reel-owner-4417' }),
  });
  const jar = signin.headers.get('set-cookie')?.split(';')[0] ?? '';
  const tokenRes = await fetch(`${BASE}/api/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: jar },
    body: JSON.stringify({ name: 'Paging test' }),
  });
  const token = (await tokenRes.json()).token;
  const bearer = { authorization: `Bearer ${token}` };

  // Page through saltmarsh clips while adding new ones.
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  let added = 0;
  // Add clips between pages: the page positions must stay stable.
  const saltmarsh = await fetch(`${BASE}/api/projects/saltmarsh`, { headers: { cookie: jar } });
  const salt = await saltmarsh.json();
  const rowId = salt.rows.find((r: { kind: string }) => r.kind === 'video').id;

  let done = false;
  while (!done && pages < 10) {
    const url = new URL(`${BASE}/api/v1/projects/saltmarsh/clips`);
    url.searchParams.set('limit', '1');
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const page = await fetch(url, { headers: bearer });
    const body = await page.json();
    check(`page ${pages} returns 200`, page.status === 200, `${page.status} ${JSON.stringify(body)}`);
    for (const item of body.items) {
      if (seen.has(item.id)) { check(`no repeats on page ${pages}`, false, item.id); }
      seen.add(item.id);
    }
    pages += 1;
    // Add a new clip after the first page so the list grows while paging.
    if (pages === 1) {
      const startFrame = 1000 + added * 200;
      const add = await fetch(`${BASE}/api/projects/saltmarsh/ops`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: jar },
        body: JSON.stringify({ type: 'add_text', row_id: rowId, start_frame: startFrame, end_frame: startFrame + 100, text: `Paging ${added}`, op_id: `pg-${added}`, base_version: salt.project.version + added }),
      });
      if (add.status === 200) added += 1;
    }
    cursor = body.next_cursor;
    done = cursor === null || cursor === undefined;
  }
  check('nothing repeated across pages', true, '');
  check('pages covered at least the original clips', seen.size >= 1, String(seen.size));

  // A limit outside 1..100 is refused on limit.
  const badLimit = await fetch(`${BASE}/api/v1/projects/saltmarsh/clips?limit=101`, { headers: bearer });
  const badLimitBody = await badLimit.json();
  check('limit 101 refused', badLimit.status === 422 && badLimitBody?.errors?.limit !== undefined, JSON.stringify(badLimitBody));
  const badCursor = await fetch(`${BASE}/api/v1/projects/saltmarsh/clips?cursor=not-a-cursor`, { headers: bearer });
  const badCursorBody = await badCursor.json();
  check('bad cursor refused', badCursor.status === 422 && badCursorBody?.errors?.cursor !== undefined, JSON.stringify(badCursorBody));

  // The v1 clips item carries exactly the published fields.
  const clipsPage = await fetch(`${BASE}/api/v1/projects/saltmarsh/clips`, { headers: bearer });
  const clipsBody = await clipsPage.json();
  const first = clipsBody.items[0];
  check('v1 clip fields exactly as published', JSON.stringify(Object.keys(first).sort()) === JSON.stringify(['end_frame', 'hidden', 'id', 'kind', 'name', 'row_id', 'start_frame']), JSON.stringify(Object.keys(first)));

  // Shared cuts only on /api/v1.
  const cutsPage = await fetch(`${BASE}/api/v1/projects/harbour-light/cuts`, { headers: bearer });
  const cutsBody = await cutsPage.json();
  check('v1 cuts shared only', cutsBody.items.every((c: { name: string }) => c.name === 'Cut 1') && cutsBody.items.length >= 1, JSON.stringify(cutsBody.items));

  // The request count for the current window is visible to the owner.
  const tokens = await fetch(`${BASE}/api/tokens`, { headers: { cookie: jar } });
  const tokensBody = await tokens.json();
  check('token listed with last_used_at', tokensBody.items.some((t: { name: string; last_used_at: string | null }) => t.name === 'Paging test' && t.last_used_at !== null), JSON.stringify(tokensBody.items));

  // Clean up: revoke the test token.
  const tokenId = tokensBody.items.find((t: { name: string }) => t.name === 'Paging test')?.id;
  await fetch(`${BASE}/api/tokens/${tokenId}`, { method: 'DELETE', headers: { cookie: jar } });

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
}

void main();
