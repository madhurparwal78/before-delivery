const base = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4173';

class Session {
  private cookie = '';

  async call(method: string, path: string, body?: unknown, key?: string): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie !== '') headers.cookie = this.cookie;
    if (key !== undefined) headers['idempotency-key'] = key;
    const response = await fetch(`${base}${path}`, {
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
}

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.log(`FAIL  ${label}`, JSON.stringify(detail)?.slice(0, 400));
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mailpitSubjects(): Promise<string[]> {
  const response = await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/messages?limit=50`);
  const body = (await response.json()) as { messages: { Subject: string; Snippet: string }[] };
  return body.messages.map((message) => `${message.Subject} :: ${message.Snippet}`);
}

async function run(): Promise<void> {
  const owner = new Session();
  await owner.call('POST', '/api/owner/session', { passcode: 'brass-rail-1897' });
  const title = `Waitlist Night ${Date.now()}`;
  const published = await owner.call('POST', '/api/owner/performances', {
    title,
    startsLocal: '2029-07-04T20:00',
    tiers: [{ name: 'Single Seat', faceCents: 2000, seats: ['ST-A-15'] }],
  });
  check('published a one-seat tier', published.status === 201, published.body);
  const performanceId: string = published.body.performance.id;
  const tierId: string = published.body.performance.tiers[0].id;

  const holder = new Session();
  const waiterOne = new Session();
  const waiterTwo = new Session();

  const held = await holder.call('POST', `/api/performances/${performanceId}/holds`, { seatIds: ['ST-A-15'] });
  check('seat held', held.status === 200, held.body);
  const soldOut = await holder.call('GET', `/api/performances/${performanceId}`);
  check('tier is sold out while held', soldOut.body.tiers[0].remaining === 0, soldOut.body.tiers);

  const joinOne = await waiterOne.call('POST', `/api/performances/${performanceId}/tiers/${tierId}/waitlist`, {
    name: 'First Waiter',
    email: 'first@example.com',
  });
  check('first waiter is place 1', joinOne.status === 201 && joinOne.body.entry.position === 1, joinOne.body);
  const joinAgain = await waiterOne.call('POST', `/api/performances/${performanceId}/tiers/${tierId}/waitlist`, {
    name: 'First Waiter',
    email: 'FIRST@example.com',
  });
  check(
    'same email cannot wait twice',
    joinAgain.status === 409 && joinAgain.body.error === 'already_waiting',
    joinAgain.body,
  );
  const joinTwo = await waiterTwo.call('POST', `/api/performances/${performanceId}/tiers/${tierId}/waitlist`, {
    name: 'Second Waiter',
    email: 'second@example.com',
  });
  check('second waiter is place 2', joinTwo.status === 201 && joinTwo.body.entry.position === 2, joinTwo.body);

  console.log('— hold expiry hands the seat to the queue —');
  const holdingCart = await holder.call('GET', `/api/performances/${performanceId}/cart`);
  await wait(((holdingCart.body.secondsLeft ?? 1) + 2) * 1_000);
  const cartAfter = await holder.call('GET', `/api/performances/${performanceId}/cart`);
  check(
    'cart empty after expiry',
    cartAfter.body.seats.length === 0 && cartAfter.body.secondsLeft === null,
    cartAfter.body,
  );
  const entriesOne = await waiterOne.call('GET', '/api/waitlist');
  const entryOne = entriesOne.body.entries[0];
  check(
    'first waiter was offered the seat',
    entryOne?.status === 'offered' && entryOne.offer?.status === 'open',
    entryOne,
  );
  check('offer total is face + fee + order fee', entryOne?.offer?.totalCents === 2000 + 130 + 150, entryOne?.offer);
  let subjects: string[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    subjects = await mailpitSubjects();
    if (subjects.some((line) => line.startsWith(`A seat is offered to you: ${title}`))) break;
    await wait(1_000);
  }
  check(
    'offer email sent',
    subjects.some((line) => line.startsWith(`A seat is offered to you: ${title}`)),
    subjects.slice(0, 3),
  );

  const token: string = entryOne.offer.token;
  const declined = await waiterOne.call('POST', `/api/offers/${token}/decline`, {});
  check('offer declined', declined.status === 200 && declined.body.offer.status === 'declined', declined.body);
  const declinedAgain = await waiterOne.call('POST', `/api/offers/${token}/decline`, {});
  check(
    'declining twice is 409',
    declinedAgain.status === 409 && declinedAgain.body.error === 'offer_closed',
    declinedAgain.body,
  );

  const entriesTwo = await waiterTwo.call('GET', '/api/waitlist');
  const entryTwo = entriesTwo.body.entries[0];
  check(
    'seat passed to the next waiter',
    entryTwo?.status === 'offered' && entryTwo.offer?.status === 'open',
    entryTwo,
  );

  const acceptKey = `accept-${Date.now()}`;
  const accepted = await waiterTwo.call('POST', `/api/offers/${entryTwo.offer.token}/accept`, {}, acceptKey);
  check('offer accepted and paid', accepted.status === 201 && accepted.body.order.status === 'paid', accepted.body);
  check('order has one ticket', accepted.body.order.tickets.length === 1, accepted.body.order?.tickets);
  check('order total matches the offer', accepted.body.order.totalCents === 2280, accepted.body.order?.totalCents);
  const replay = await waiterTwo.call('POST', `/api/offers/${entryTwo.offer.token}/accept`, {}, acceptKey);
  check(
    'accept replay is the same order',
    replay.status === 201 && replay.body.order.id === accepted.body.order.id,
    replay.body,
  );
  const closed = await waiterTwo.call('POST', `/api/offers/${entryTwo.offer.token}/accept`, {}, `${acceptKey}-b`);
  check(
    'accepting a closed offer is 409',
    closed.status === 409 && closed.body.error === 'offer_closed',
    closed.body,
  );

  console.log('— offer expiry —');
  const refundOwner = accepted.body.order;
  const waiterThree = new Session();
  const joinThree = await waiterThree.call('POST', `/api/performances/${performanceId}/tiers/${tierId}/waitlist`, {
    name: 'Third Waiter',
    email: 'third@example.com',
  });
  check('third waiter joined the sold-out tier', joinThree.status === 201, joinThree.body);
  const refunded = await waiterTwo.call(
    'POST',
    `/api/orders/${refundOwner.id}/refunds`,
    { ticketIds: [refundOwner.tickets[0].id] },
    `rfw-${Date.now()}`,
  );
  check('refund frees the seat', refunded.status === 200, refunded.body);
  await wait(1_200);
  const entriesThree = await waiterThree.call('GET', '/api/waitlist');
  const offerThree = entriesThree.body.entries[0]?.offer;
  check('refunded seat was offered onward', offerThree?.status === 'open', entriesThree.body.entries[0]);
  await wait((offerThree.secondsLeft + 2) * 1_000);
  const expired = await waiterThree.call('GET', `/api/offers/${offerThree.token}`);
  check('offer reads expired', expired.body.offer.status === 'expired', expired.body);
  const lateAccept = await waiterThree.call(
    'POST',
    `/api/offers/${offerThree.token}/accept`,
    {},
    `late-${Date.now()}`,
  );
  check(
    'late acceptance is 410',
    lateAccept.status === 410 && lateAccept.body.error === 'offer_expired',
    lateAccept.body,
  );
  const backOnSale = await waiterThree.call('GET', `/api/performances/${performanceId}`);
  check('seat back on sale with nobody waiting', backOnSale.body.tiers[0].remaining === 1, backOnSale.body.tiers);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void run();
