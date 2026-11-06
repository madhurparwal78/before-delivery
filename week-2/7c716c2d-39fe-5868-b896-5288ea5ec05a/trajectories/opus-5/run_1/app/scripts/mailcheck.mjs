// Runs a copy whose SMTP is unreachable and checks held mail, the held count
// falling as records go, and delivery resuming without a restart.
import { spawn } from 'node:child_process';

const port = Number(process.env.MAIL_PORT ?? '4196');
const base = `http://127.0.0.1:${port}`;

function start(smtpPort) {
  const child = spawn('node', ['dist/server/index.js'], {
    env: { ...process.env, APP_PUBLIC_PORT: String(port), SMTP_PORT: String(smtpPort), OUTBOX_RETRY_SECONDS: '2' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (data) => process.stderr.write(`[copy] ${String(data)}`));
  return child;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ready() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return true;
    } catch {
      // not serving yet
    }
    await wait(300);
  }
  return false;
}

async function signIn(email) {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'tally-demo-1' }),
  });
  await response.json();
  return (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(';')[0])
    .find((entry) => entry.startsWith('tr_session='));
}

async function call(cookie, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? { cookie } : { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

let child = start(1);
console.log('serving with mail down:', await ready());
await wait(1500);
const ana = await signIn('ana@kereru.test');
const first = `held.a.${Date.now().toString(36)}@contract.test`;
const second = `held.b.${Date.now().toString(36)}@contract.test`;
console.log('invite one:', (await call(ana, 'POST', '/api/invites', { email: first, role: 'member', project_ids: [], channel_ids: [] })).status);
const secondInvite = await call(ana, 'POST', '/api/invites', { email: second, role: 'member', project_ids: [], channel_ids: [] });
console.log('invite two:', secondInvite.status);
const channels = (await call(ana, 'GET', '/api/channels')).json.channels;
const general = channels.find((channel) => channel.name === 'general');
console.log('mention:', (await call(ana, 'POST', `/api/channels/${general.id}/messages`, { body: 'Held mail ping @ben' })).status);
await wait(2500);
const delayed = (await call(ana, 'GET', '/api/status')).json;
console.log('status while mail is down:', delayed);
console.log('revoke one:', (await call(ana, 'DELETE', `/api/invites/${secondInvite.json.id}`)).status);
const afterRevoke = (await call(ana, 'GET', '/api/status')).json;
console.log('held count in the next status check:', afterRevoke.held_mail, 'was', delayed.held_mail);
console.log('held fell by one:', afterRevoke.held_mail === delayed.held_mail - 1);

child.kill();
await wait(800);
child = start(process.env.SMTP_PORT ?? 1025);
console.log('serving with mail back:', await ready());
await wait(6000);
const anaAgain = await signIn('ana@kereru.test');
const recovered = (await call(anaAgain, 'GET', '/api/status')).json;
console.log('status after recovery:', recovered);
const firstMail = await (await fetch(`http://mailpit:8025/api/v1/search?query=${encodeURIComponent(first)}`)).json();
const secondMail = await (await fetch(`http://mailpit:8025/api/v1/search?query=${encodeURIComponent(second)}`)).json();
console.log('held invite delivered once:', firstMail.messages_count);
console.log('revoked invite never delivered:', secondMail.messages_count);
child.kill();
await wait(500);
