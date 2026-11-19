import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const UNREACHABLE_HOST = '127.0.0.1';
const UNREACHABLE_PORT = '9';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.log(`FAIL  ${label}`, JSON.stringify(detail)?.slice(0, 300));
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function startServer(port: number, overrides: Record<string, string>): ChildProcess {
  const child = spawn('node', ['dist/server/index.js'], {
    cwd: '/app',
    env: { ...process.env, APP_PUBLIC_PORT: String(port), ...overrides },
    stdio: 'ignore',
  });
  return child;
}

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await wait(500);
  }
  throw new Error(`server on ${port} never became healthy`);
}

class Session {
  private cookie = '';

  constructor(private readonly port: number) {}

  async call(method: string, path: string, body?: unknown, key?: string): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie !== '') headers.cookie = this.cookie;
    if (key !== undefined) headers['idempotency-key'] = key;
    const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? '';
      const name = pair.split('=')[0] ?? '';
      const others = this.cookie.split('; ').filter((part) => part !== '' && !part.startsWith(`${name}=`));
      this.cookie = [...others, pair].join('; ');
    }
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: response.status, body: text.slice(0, 120) };
    }
  }

  use(cookie: string): void {
    this.cookie = cookie;
  }

  get jar(): string {
    return this.cookie;
  }
}

async function mailpitSubjects(): Promise<string[]> {
  const response = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
  const body = (await response.json()) as { messages: { Subject: string }[] };
  return body.messages.map((message) => message.Subject);
}

/** These checks need to know which copies of the server are running, so other copies are stopped. */
function stopOtherServers(): void {
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      if (!readFileSync(`/proc/${entry}/cmdline`, 'utf8').includes('dist/server/index.js')) continue;
      process.kill(Number(entry));
    } catch {
      /* the process went away on its own */
    }
  }
}

async function run(): Promise<void> {
  const performanceId = 'fen-and-lark';
  stopOtherServers();
  await wait(1000);

  console.log('— Kill Bill unreachable —');
  const paused = startServer(4277, {
    KILLBILL_URL: `http://${UNREACHABLE_HOST}:${UNREACHABLE_PORT}`,
    SMTP_HOST: UNREACHABLE_HOST,
    SMTP_PORT: UNREACHABLE_PORT,
  });
  await waitForHealth(4277);
  const fan = new Session(4277);
  const open = await fan.call('GET', `/api/performances/${performanceId}/seats`);
  const freeSeats: string[] = open.body.seats
    .filter((seat: any) => seat.state === 'on_sale' && seat.tierId === 'stalls')
    .slice(0, 2)
    .map((seat: any) => seat.id);
  const held = await fan.call('POST', `/api/performances/${performanceId}/holds`, { seatIds: freeSeats });
  check('seats held while payments are paused', held.status === 200, held.body);
  const before = await fan.call('GET', `/api/performances/${performanceId}`);
  const remainingBefore = before.body.tiers.find((tier: any) => tier.id === 'stalls').remaining;
  const attempt = await fan.call(
    'POST',
    `/api/performances/${performanceId}/checkout`,
    { name: 'Paula Pause', email: 'paula@example.com' },
    `pause-${Date.now()}`,
  );
  check(
    'checkout answers 503',
    attempt.status === 503 && attempt.body.error === 'payments_unavailable',
    attempt.body,
  );
  const cart = await fan.call('GET', `/api/performances/${performanceId}/cart`);
  check('seats stay held', cart.body.seats.length === 2, cart.body);
  const after = await fan.call('GET', `/api/performances/${performanceId}`);
  const remainingAfter = after.body.tiers.find((tier: any) => tier.id === 'stalls').remaining;
  check('seats remaining unchanged', remainingBefore === remainingAfter, { remainingBefore, remainingAfter });
  const orders = await fan.call('GET', '/api/orders');
  check('no order is listed', orders.body.orders.length === 0, orders.body.orders);
  const seats = await fan.call('GET', `/api/performances/${performanceId}/seats`);
  check(
    'no seat was sold',
    seats.body.seats.filter((seat: any) => seat.state === 'sold' && freeSeats.includes(seat.id)).length === 0,
    freeSeats,
  );

  console.log('— mail unreachable, then back —');
  const broken = startServer(4278, { SMTP_HOST: UNREACHABLE_HOST, SMTP_PORT: UNREACHABLE_PORT });
  await waitForHealth(4278);
  const mailFan = new Session(4278);
  mailFan.use(fan.jar);
  const paidResult = await mailFan.call(
    'POST',
    `/api/performances/${performanceId}/checkout`,
    { name: 'Paula Pause', email: 'paula@example.com' },
    `mail-${Date.now()}`,
  );
  check('tickets are issued while mail is down', paidResult.status === 201, paidResult.body);
  check('receipt is queued', paidResult.body.order?.receipt === 'queued', paidResult.body.order?.receipt);
  const orderId: string = paidResult.body.order.id;
  await wait(4000);
  const subjectsDuringOutage = await mailpitSubjects();
  check(
    'nothing was delivered during the outage',
    !subjectsDuringOutage.includes(`Your Halyard Hall tickets: order ${orderId}`),
    subjectsDuringOutage.slice(0, 3),
  );

  const healthy = startServer(4279, {});
  await waitForHealth(4279);
  let delivered: string[] = [];
  for (let attempt2 = 0; attempt2 < 30; attempt2 += 1) {
    await wait(1000);
    delivered = (await mailpitSubjects()).filter(
      (subject) => subject === `Your Halyard Hall tickets: order ${orderId}`,
    );
    if (delivered.length > 0) break;
  }
  check('the queued receipt was sent once mail returned', delivered.length === 1, delivered);
  await wait(3000);
  const again = (await mailpitSubjects()).filter(
    (subject) => subject === `Your Halyard Hall tickets: order ${orderId}`,
  );
  check('it was sent exactly once', again.length === 1, again);

  const owner = new Session(4279);
  await owner.call('POST', '/api/owner/session', { passcode: 'brass-rail-1897' });
  const outbox = await owner.call('GET', '/api/owner/outbox');
  const record = outbox.body.messages.find((message: any) => message.subject.includes(orderId));
  check('the outbox marks it sent', record?.status === 'sent', record);

  for (const child of [paused, broken, healthy]) child.kill();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void run();
