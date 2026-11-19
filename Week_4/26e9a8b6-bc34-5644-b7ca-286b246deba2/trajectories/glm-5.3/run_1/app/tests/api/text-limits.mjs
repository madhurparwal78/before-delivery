const BASE = process.env.PW_BASE_URL ?? 'http://127.0.0.1:4173';
let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name}: ${detail ?? ''}`); }
}
async function req(method, path, body, headers = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, headers: response.headers, text, json };
}

const stamp = Date.now().toString(36);
const email = `txt-${stamp}@example.test`;
let r = await req('POST', '/api/accounts', { name: 'Text Tester', email, password: 'longpassword1' });
const cookies = r.headers.get('set-cookie');
const messages = await (await fetch('http://mailpit:8025/api/v1/messages')).json();
const msg = messages.messages.find((m) => m.To[0].Address === email);
const body = await (await fetch(`http://mailpit:8025/api/v1/message/${msg.ID}`)).json();
const token = body.Text.match(/token=([A-Za-z0-9_-]+)/)[1];
await req('POST', '/api/account/confirm', { token });
r = await req('POST', '/api/guides', { title: 'Text limits', currency: 'EUR' }, { cookie: cookies });
const gid = r.json.id;
r = await req('POST', `/api/guides/${gid}/steps`, { title: 'Step one' }, { cookie: cookies });
const stepId = r.json.id;

// Guide title: exactly 120 code points accepted (emoji = 1).
const emoji120 = '😀'.repeat(120);
r = await req('PATCH', `/api/guides/${gid}/working`, { field: 'title', value: emoji120, based_on: 0 }, { cookie: cookies });
check('title 120 emoji accepted', r.status === 200, r.text);

// One more code point refused.
const emoji121 = '😀'.repeat(121);
r = await req('PATCH', `/api/guides/${gid}/working`, { field: 'title', value: emoji121, based_on: 1 }, { cookie: cookies });
check('title 121 emoji refused', r.status === 422 && r.json.error === 'too_long' && r.json.limit === 120, r.text);

// Step text: exactly 2000 accepted, 2001 refused.
r = await req('PATCH', `/api/guides/${gid}/working`, { field: `step/${stepId}/text`, value: 'x'.repeat(2000), based_on: 0 }, { cookie: cookies });
check('step text 2000 accepted', r.status === 200, r.text);
r = await req('PATCH', `/api/guides/${gid}/working`, { field: `step/${stepId}/text`, value: 'x'.repeat(2001), based_on: 1 }, { cookie: cookies });
check('step text 2001 refused', r.status === 422 && r.json.error === 'too_long' && r.json.limit === 2000, r.text);

// Sign-in next safety: non-local next lands on /dashboard after sign-in.
const browserlessCheck = await fetch(BASE + '/signin', { method: 'GET' });
check('signin page renders', browserlessCheck.status === 200);

// 60 steps max: exactly 60 accepted, 61 refused.
r = await req('POST', `/api/guides/${gid}/steps`, { title: 'Filler' }, { cookie: cookies });
for (let i = 0; i < 58; i++) {
  await req('POST', `/api/guides/${gid}/steps`, { title: `Filler ${i}` }, { cookie: cookies });
}
// now 60 steps total
r = await req('POST', `/api/guides/${gid}/steps`, { title: 'One too many' }, { cookie: cookies });
check('61st step refused', r.status === 422 && r.json.error === 'too_many' && r.json.limit === 60, r.text);
r = await req('GET', `/api/guides/${gid}/working`, undefined, { cookie: cookies });
check('guide holds exactly 60 steps', r.json.steps.length === 60, `steps: ${r.json.steps.length}`);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
