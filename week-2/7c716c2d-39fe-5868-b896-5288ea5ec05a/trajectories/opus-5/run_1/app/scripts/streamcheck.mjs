// Checks event replay, access revocation and stream release.
import pg from 'pg';

const base = process.env.BASE ?? 'http://127.0.0.1:4173';

async function signIn(email, password = 'tally-demo-1') {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  await response.json();
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(';')[0])
    .find((entry) => entry.startsWith('tr_session='));
  return cookie;
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

function openStream(cookie, lastEventId) {
  const controller = new AbortController();
  const events = [];
  const started = fetch(`${base}/api/events`, {
    headers: lastEventId === undefined ? { cookie } : { cookie, 'last-event-id': String(lastEventId) },
    signal: controller.signal,
  }).then(async (response) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const id = /^id: (\d+)$/m.exec(frame)?.[1];
        const name = /^event: (\w+)$/m.exec(frame)?.[1];
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (name !== undefined) events.push({ id: Number(id ?? 0), name, data });
        index = buffer.indexOf('\n\n');
      }
    }
  });
  return { events, close: () => controller.abort(), started };
}

const ben = await signIn('ben@kereru.test');
const ana = await signIn('ana@kereru.test');

const live = openStream(ben);
await new Promise((resolve) => setTimeout(resolve, 500));

const channels = (await call(ben, 'GET', '/api/channels')).json.channels;
const general = channels.find((channel) => channel.name === 'general');
const posted = await call(ana, 'POST', `/api/channels/${general.id}/messages`, { body: 'Stream check one' });
await new Promise((resolve) => setTimeout(resolve, 1200));
const names = live.events.map((event) => event.name);
console.log('live events:', names);
console.log('message delivered:', names.includes('message'));
const lastId = Math.max(...live.events.map((event) => event.id), 0);
live.close();

await call(ana, 'POST', `/api/channels/${general.id}/messages`, { body: 'Stream check two while away' });
await new Promise((resolve) => setTimeout(resolve, 400));
const replay = openStream(ben, lastId);
await new Promise((resolve) => setTimeout(resolve, 1200));
console.log('replayed:', replay.events.map((event) => `${event.id}:${event.name}`));
const replayedMessages = replay.events.filter((event) => event.name === 'message');
console.log('replay delivered the missed message exactly once:', replayedMessages.length === 1);
console.log('ids in order:', replay.events.every((event, index, all) => index === 0 || all[index - 1].id <= event.id));
replay.close();

const reset = openStream(ben, 0);
await new Promise((resolve) => setTimeout(resolve, 800));
console.log('reset or replay from 0:', reset.events.slice(0, 2).map((event) => event.name));
reset.close();

// --- aborted streams release their database sessions
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const countSessions = async () => {
  const { rows } = await client.query(
    "select count(*)::int as count, count(*) filter (where state = 'idle in transaction')::int as stuck from pg_stat_activity where application_name like 'tallyroom%'",
  );
  return rows[0];
};
const before = await countSessions();
for (let attempt = 0; attempt < 20; attempt += 1) {
  const aborted = openStream(ben);
  await new Promise((resolve) => setTimeout(resolve, 60));
  aborted.close();
}
await new Promise((resolve) => setTimeout(resolve, 5000));
const after = await countSessions();
console.log('sessions before/after:', before, after);
console.log('within 2 sessions:', Math.abs(after.count - before.count) <= 2);
console.log('none idle in transaction:', after.stuck === 0);
console.log('next request ok:', (await call(ben, 'GET', '/api/workspace')).status === 200);

// --- removal ends access and revokes the stream
const victimEmail = `leaver.${Date.now().toString(36)}@contract.test`;
const invite = await call(ana, 'POST', '/api/invites', {
  email: victimEmail,
  role: 'member',
  project_ids: [],
  channel_ids: [],
});
console.log('invite for removal test:', invite.status);
await fetch(`${base}/api/accounts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Leaver One', email: victimEmail, password: 'leaver-pass-1' }),
});
const victim = await signIn(victimEmail, 'leaver-pass-1');
const mine = (await call(victim, 'GET', '/api/invites/mine')).json.invites[0];
console.log('accept:', (await call(victim, 'POST', `/api/invites/${mine.id}/accept`, {})).status);
const victimStream = openStream(victim);
await new Promise((resolve) => setTimeout(resolve, 600));
const members = (await call(ana, 'GET', '/api/members')).json.members;
const victimPerson = members.find((person) => person.email === victimEmail);
console.log('remove:', (await call(ana, 'DELETE', `/api/members/${victimPerson.id}`)).status);
await new Promise((resolve) => setTimeout(resolve, 2000));
console.log('victim events:', victimStream.events.map((event) => `${event.name}:${event.data}`).slice(-3));
console.log('next request after removal:', (await call(victim, 'GET', '/api/workspace')).status);
victimStream.close();
await client.end();
