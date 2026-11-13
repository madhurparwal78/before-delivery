// Exercises the running server over HTTP, as a browser would.
const BASE = process.env['QUILLMOOR_BASE'] ?? 'http://127.0.0.1:4173';

let fails = 0;
let checks = 0;
export const chk = (label, got, want) => {
  checks += 1;
  const ok = String(got) === String(want);
  if (!ok) fails += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label} = ${String(got)}${ok ? '' : `  want ${String(want)}`}`,
  );
  return ok;
};
export const note = (text) => console.log(`---- ${text}`);
export const summary = () => {
  console.log(fails === 0 ? `\nALL ${checks} PASS` : `\n${fails} of ${checks} FAILED`);
  if (fails > 0) process.exitCode = 1;
};

export async function raw(method, path, { token, body, headers = {}, key, ifMatch } = {}) {
  const all = { ...headers };
  if (token !== undefined) all['authorization'] = `Bearer ${token}`;
  if (key !== undefined) all['idempotency-key'] = key;
  if (ifMatch !== undefined) all['if-match'] = ifMatch;
  if (body !== undefined && all['content-type'] === undefined) {
    all['content-type'] = 'application/json';
  }
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: all,
    ...(body === undefined
      ? {}
      : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers, text };
}

export const get = (path, token) => raw('GET', path, { token });
export const post = (path, body, token, extra) => raw('POST', path, { token, body, ...extra });
export const patch = (path, body, token, extra) =>
  raw('PATCH', path, { token, body, ...extra });

export async function sessionFor(actorId) {
  const reply = await post('/api/sessions', { actor_id: actorId });
  if (reply.status !== 201) throw new Error(`session for ${actorId}: ${reply.text}`);
  return reply.body.token;
}

/** A retry key that is unique to this test run, since keys are kept forever. */
const RUN = Math.random().toString(36).slice(2, 8);
export const runKey = (name) => `${RUN}-${name}`;

export { BASE };
