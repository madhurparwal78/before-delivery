const base = process.env.BASE ?? 'http://127.0.0.1:4173';
const jar = new Map();

function cookieHeader(who) {
  const token = jar.get(who);
  return token === undefined ? {} : { cookie: `tf_session=${token}` };
}

export async function api(who, method, path, body, extra = {}) {
  const headers = { 'content-type': 'application/json', origin: base, ...cookieHeader(who), ...extra };
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    const match = /tf_session=([^;]*)/.exec(setCookie);
    if (match) jar.set(who, match[1]);
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

export async function signIn(who) {
  const result = await api(who, 'POST', '/api/auth/sign-in', {
    email: `${who}@harbourlane.test`,
    password: 'ledger-demo-2026',
  });
  if (result.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(result.body)}`);
  return result.body.user;
}

let failures = 0;
export function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}\n  actual:   ${a}\n  expected: ${b}`);
  }
}

export function done() {
  console.log(failures === 0 ? 'ALL OK' : `${failures} FAILURES`);
  if (failures > 0) process.exitCode = 1;
}
