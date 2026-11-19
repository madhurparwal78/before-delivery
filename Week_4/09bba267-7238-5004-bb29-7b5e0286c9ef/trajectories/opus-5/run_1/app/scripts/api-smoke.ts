const base = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4173';

interface Call {
  status: number;
  body: any;
  cookies: string[];
}

class Session {
  private cookie = '';

  async call(method: string, path: string, body?: unknown, key?: string): Promise<Call> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie !== '') headers.cookie = this.cookie;
    if (key !== undefined) headers['idempotency-key'] = key;
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = response.headers.getSetCookie();
    for (const raw of setCookies) {
      const pair = raw.split(';')[0] ?? '';
      const name = pair.split('=')[0] ?? '';
      const others = this.cookie.split('; ').filter((part) => part !== '' && !part.startsWith(`${name}=`));
      this.cookie = [...others, pair].join('; ');
    }
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text.slice(0, 80);
    }
    return { status: response.status, body: parsed, cookies: setCookies };
  }
}

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}`, JSON.stringify(detail)?.slice(0, 400));
  }
}

const performanceId = 'lantern-and-tide';

async function run(): Promise<void> {
  const fan = new Session();
  const rival = new Session();

  console.log('— holds —');
  const held = await fan.call('POST', `/api/performances/${performanceId}/holds`, {
    seatIds: ['ST-I-12', 'ST-I-13'],
  });
  check('two seats held', held.status === 200 && held.body.held.length === 2, held.body);
  check('cart total 9736', held.body.cart?.totalCents === 9736, held.body.cart);
  check('seconds left near hold length', (held.body.cart?.secondsLeft ?? 0) > 0, held.body.cart?.secondsLeft);

  const contested = await rival.call('POST', `/api/performances/${performanceId}/holds`, {
    seatIds: ['ST-I-13', 'ST-I-14'],
  });
  check('rival keeps one seat', contested.status === 200 && contested.body.held.length === 1, contested.body);
  check('rival sees taken seat', contested.body.taken?.[0] === 'ST-I-13', contested.body);

  const allTaken = await rival.call('POST', `/api/performances/${performanceId}/holds`, { seatIds: ['ST-I-12'] });
  check('all taken is 409', allTaken.status === 409 && allTaken.body.error === 'seats_taken', allTaken.body);

  const badShape = await fan.call('POST', `/api/performances/${performanceId}/holds`, { seatIds: [] });
  check(
    'empty seat list is 422',
    badShape.status === 422 && 'seatIds' in (badShape.body.fields ?? {}),
    badShape.body,
  );

  const limit = await fan.call('POST', `/api/performances/${performanceId}/holds`, {
    seatIds: ['ST-J-1', 'ST-J-2', 'ST-J-3', 'ST-J-4', 'ST-J-5', 'ST-J-6', 'ST-J-7'],
  });
  check('over the seat limit is 422', limit.status === 422, limit.body);

  console.log('— checkout —');
  const noKey = await fan.call('POST', `/api/performances/${performanceId}/checkout`, {
    name: 'Ada Fan',
    email: 'ada@example.com',
  });
  check(
    'missing idempotency key is 422',
    noKey.status === 422 && noKey.body.fields?.idempotencyKey !== undefined,
    noKey.body,
  );

  const badEmail = await fan.call(
    'POST',
    `/api/performances/${performanceId}/checkout`,
    { name: '', email: 'nope' },
    'key-bad-email',
  );
  check(
    'bad fields are 422',
    badEmail.status === 422 && Object.keys(badEmail.body.fields).length === 2,
    badEmail.body,
  );

  const key = `key-${Date.now()}`;
  const paid = await fan.call(
    'POST',
    `/api/performances/${performanceId}/checkout`,
    { name: 'Ada Fan', email: 'ada@example.com' },
    key,
  );
  check('checkout paid', paid.status === 201 && paid.body.order?.status === 'paid', paid.body);
  check(
    'tickets issued',
    paid.body.order?.tickets?.every((t: any) => t.status === 'issued'),
    paid.body.order?.tickets,
  );
  check('receipt queued or sent', ['queued', 'sent'].includes(paid.body.order?.receipt), paid.body.order?.receipt);
  check('order total 9736', paid.body.order?.totalCents === 9736, paid.body.order);
  const orderId: string = paid.body.order.id;

  const replay = await fan.call(
    'POST',
    `/api/performances/${performanceId}/checkout`,
    { name: 'Ada Fan', email: 'ada@example.com' },
    key,
  );
  check('replay returns the first order', replay.status === 201 && replay.body.order?.id === orderId, replay.body);

  const conflict = await fan.call(
    'POST',
    `/api/performances/${performanceId}/checkout`,
    { name: 'Someone Else', email: 'else@example.com' },
    key,
  );
  check(
    'key reuse with another body is 409',
    conflict.status === 409 && conflict.body.error === 'idempotency_conflict',
    conflict.body,
  );

  const emptyCart = await fan.call(
    'POST',
    `/api/performances/${performanceId}/checkout`,
    { name: 'Ada Fan', email: 'ada@example.com' },
    `${key}-2`,
  );
  check('empty cart is 409', emptyCart.status === 409 && emptyCart.body.error === 'cart_empty', emptyCart.body);

  const ticketsCount = await fan.call('POST', `/api/performances/${performanceId}/holds`, {
    seatIds: ['ST-J-1', 'ST-J-2', 'ST-J-3', 'ST-J-4', 'ST-J-5', 'ST-J-6', 'ST-J-7'],
  });
  check(
    'issued tickets count towards the seat limit',
    ticketsCount.status === 422 &&
      ticketsCount.body.fields?.seatIds === 'You can hold up to 8 seats for a performance.',
    ticketsCount.body,
  );
  const withinLimit = await fan.call('POST', `/api/performances/${performanceId}/holds`, {
    seatIds: ['ST-J-1', 'ST-J-2', 'ST-J-3', 'ST-J-4', 'ST-J-5', 'ST-J-6'],
  });
  check('six more seats are allowed beside two tickets', withinLimit.status === 200, withinLimit.body);
  for (const seatId of ['ST-J-1', 'ST-J-2', 'ST-J-3', 'ST-J-4', 'ST-J-5', 'ST-J-6']) {
    await fan.call('DELETE', `/api/performances/${performanceId}/holds/${seatId}`);
  }

  console.log('— seats and counts —');
  const seats = await fan.call('GET', `/api/performances/${performanceId}/seats`);
  check('900 seats', seats.body.seats?.length === 900, seats.body.seats?.length);
  const mine = seats.body.seats.filter((seat: any) => seat.state === 'sold' && seat.mine);
  check('this buyer holds two sold seats', mine.length === 2, mine);
  const geometry = seats.body.seats.find((seat: any) => seat.id === 'ST-A-1');
  check('geometry present', geometry.offCentreDeg === -35 && geometry.stageDistanceM === 4.9, geometry);

  console.log('— exchange —');
  const ticketId: string = paid.body.order.tickets[0].id;
  const exchange = await fan.call(
    'POST',
    `/api/tickets/${ticketId}/exchange`,
    { newSeatId: 'ST-A-20' },
    `ex-${Date.now()}`,
  );
  check(
    'exchange charges the difference',
    exchange.status === 200 && exchange.body.differenceCents === 2449,
    exchange.body,
  );
  const exchanged = exchange.body.order.tickets.find((t: any) => t.id === ticketId);
  check('ticket moved seat', exchanged?.seatId === 'ST-A-20' && exchanged.status === 'issued', exchanged);

  const takenExchange = await fan.call(
    'POST',
    `/api/tickets/${ticketId}/exchange`,
    { newSeatId: 'ST-I-14' },
    `ex2-${Date.now()}`,
  );
  check(
    'exchange onto a held seat is 409',
    takenExchange.status === 409 && takenExchange.body.error === 'seats_taken',
    takenExchange.body,
  );

  const sameSeat = await fan.call(
    'POST',
    `/api/tickets/${ticketId}/exchange`,
    { newSeatId: 'ST-A-20' },
    `ex3-${Date.now()}`,
  );
  check('exchange to the same seat is 422', sameSeat.status === 422, sameSeat.body);

  console.log('— refund —');
  const backTicket: string = paid.body.order.tickets[1].id;
  const partial = await fan.call(
    'POST',
    `/api/orders/${orderId}/refunds`,
    { ticketIds: [backTicket] },
    `rf-${Date.now()}`,
  );
  check(
    'partial refund excludes the order fee',
    partial.status === 200 && partial.body.refundCents === 4793,
    partial.body,
  );
  check('order partially refunded', partial.body.order?.status === 'partially_refunded', partial.body.order?.status);

  const rest = await fan.call(
    'POST',
    `/api/orders/${orderId}/refunds`,
    { ticketIds: [ticketId] },
    `rf2-${Date.now()}`,
  );
  check('final refund adds the order fee', rest.status === 200 && rest.body.refundCents === 7392, rest.body);
  check('order refunded', rest.body.order?.status === 'refunded', rest.body.order?.status);
  check('net paid is zero', rest.body.order?.netPaidCents === 0, rest.body.order?.netPaidCents);

  const again = await fan.call(
    'POST',
    `/api/orders/${orderId}/refunds`,
    { ticketIds: [ticketId] },
    `rf3-${Date.now()}`,
  );
  check('refunding twice is 409', again.status === 409 && again.body.error === 'ticket_not_issued', again.body);

  console.log('— owner —');
  const ownerSession = new Session();
  const wrong = await ownerSession.call('POST', '/api/owner/session', { passcode: 'nope' });
  check('wrong passcode is 401', wrong.status === 401, wrong.body);
  const unauthorised = await ownerSession.call('GET', '/api/owner/orders');
  check('owner endpoint needs a session', unauthorised.status === 401, unauthorised.body);
  const signIn = await ownerSession.call('POST', '/api/owner/session', { passcode: 'brass-rail-1897' });
  check('owner signed in', signIn.status === 204, signIn.body);
  const ownerOrders = await ownerSession.call('GET', '/api/owner/orders');
  const ownerOrder = ownerOrders.body.orders.find((order: any) => order.id === orderId);
  check(
    'owner sees kill bill ids',
    (ownerOrder?.killbillPaymentIds?.length ?? 0) >= 2,
    ownerOrder?.killbillPaymentIds,
  );
  check(
    'owner sees the account id',
    typeof ownerOrder?.killbillAccountId === 'string',
    ownerOrder?.killbillAccountId,
  );
  const ownerPerformances = await ownerSession.call('GET', '/api/owner/performances');
  const tiers = ownerPerformances.body.performances.find((p: any) => p.id === performanceId).tiers;
  check(
    'owner tier counts present',
    tiers.every((tier: any) => 'onSale' in tier && 'held' in tier),
    tiers[0],
  );
  const outbox = await ownerSession.call('GET', '/api/owner/outbox');
  check('outbox lists mail', outbox.body.messages.length > 0, outbox.body.messages?.slice(0, 2));
  check(
    'receipt message present',
    outbox.body.messages.some((m: any) => m.kind === 'receipt' && m.subject.includes(orderId)),
    outbox.body.messages?.slice(0, 3),
  );

  const published = await ownerSession.call('POST', '/api/owner/performances', {
    title: 'Smoke Test Night',
    startsLocal: '2029-09-09T20:00',
    tiers: [{ name: 'Stalls Flat', faceCents: 3000, rows: ['ST-A'], seats: ['CI-A-1'] }],
  });
  check(
    'publish works',
    published.status === 201 && published.body.performance?.tiers[0].remaining === 31,
    published.body,
  );
  const skipped = await ownerSession.call('POST', '/api/owner/performances', {
    title: 'Impossible',
    startsLocal: '2027-03-14T02:30',
    tiers: [{ name: 'Stalls Flat', faceCents: 3000, rows: ['ST-A'] }],
  });
  check(
    'skipped wall time rejected',
    skipped.status === 422 && skipped.body.fields.startsLocal.includes('Chicago'),
    skipped.body,
  );
  const past = await ownerSession.call('POST', '/api/owner/performances', {
    title: 'Yesterday',
    startsLocal: '2020-01-01T20:00',
    tiers: [{ name: 'Stalls Flat', faceCents: 3000, rows: ['ST-A'] }],
  });
  check('past start rejected', past.status === 422 && past.body.fields.startsLocal.includes('future'), past.body);

  console.log('— waitlist and offers —');
  const smallId: string = published.body.performance.id;
  const smallTier: string = published.body.performance.tiers[0].id;
  const notSoldOut = await fan.call('POST', `/api/performances/${smallId}/tiers/${smallTier}/waitlist`, {
    name: 'Early Bird',
    email: 'early@example.com',
  });
  check(
    'cannot wait while seats remain',
    notSoldOut.status === 409 && notSoldOut.body.error === 'tier_not_sold_out',
    notSoldOut.body,
  );

  console.log('— change window —');
  const soonParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const part = (type: string): string => soonParts.find((candidate) => candidate.type === type)?.value ?? '';
  const soonStart = `${part('year')}-${part('month')}-${part('day')}T${part('hour') === '24' ? '00' : part('hour')}:${part('minute')}`;
  const soon = await ownerSession.call('POST', '/api/owner/performances', {
    title: `Tonight ${Date.now()}`,
    startsLocal: soonStart,
    tiers: [{ name: 'Door Seats', faceCents: 2500, rows: ['BA-F'] }],
  });
  check('a performance inside the change window publishes', soon.status === 201, soon.body);
  const soonId: string = soon.body.performance.id;
  check(
    'its sales are open but changes are closed',
    soon.body.performance.salesOpen && !soon.body.performance.changesOpen,
    {
      salesOpen: soon.body.performance.salesOpen,
      changesOpen: soon.body.performance.changesOpen,
    },
  );
  const doorFan = new Session();
  await doorFan.call('POST', `/api/performances/${soonId}/holds`, { seatIds: ['BA-F-9'] });
  const doorOrder = await doorFan.call(
    'POST',
    `/api/performances/${soonId}/checkout`,
    { name: 'Dora Door', email: 'dora@example.com' },
    `door-${Date.now()}`,
  );
  check('the door ticket is paid', doorOrder.status === 201, doorOrder.body);
  const doorTicket = doorOrder.body.order.tickets[0].id;
  const lateExchange = await doorFan.call(
    'POST',
    `/api/tickets/${doorTicket}/exchange`,
    { newSeatId: 'BA-F-10' },
    `late-ex-${Date.now()}`,
  );
  check(
    'exchange after the cutoff is 409',
    lateExchange.status === 409 && lateExchange.body.error === 'changes_closed',
    lateExchange.body,
  );
  const lateRefund = await doorFan.call(
    'POST',
    `/api/orders/${doorOrder.body.order.id}/refunds`,
    { ticketIds: [doorTicket] },
    `late-rf-${Date.now()}`,
  );
  check(
    'refund after the cutoff is 409',
    lateRefund.status === 409 && lateRefund.body.error === 'changes_closed',
    lateRefund.body,
  );

  console.log('— receipt email —');
  const mail = await fetch(
    `${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/search?query=${encodeURIComponent(orderId)}`,
  );
  const found = (await mail.json()) as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
  const receipt = found.messages.find((message) => message.Subject === `Your Halyard Hall tickets: order ${orderId}`);
  check(
    'one receipt reached the mail server',
    receipt !== undefined,
    found.messages.map((m) => m.Subject),
  );
  if (receipt !== undefined) {
    const raw = await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/message/${receipt.ID}`);
    const body = (await raw.json()) as { Text: string; From: { Address: string; Name: string } };
    const lines = body.Text.split(/\r?\n/).map((line) => line.trim());
    check('receipt names the order', lines.includes(`Order ${orderId}`), lines.slice(0, 3));
    check('receipt shows the venue start', lines.includes('Fri 12 Feb 2027, 8:00 PM CST'), lines.slice(0, 4));
    check(
      'receipt itemises a ticket',
      lines.some((line) => /^Stalls row I seat 1[23] \(B Reserve\): face \$45\.00, fee \$2\.93$/.test(line)),
      lines,
    );
    check('receipt shows the order fee', lines.includes('Order fee $1.50'), lines);
    check('receipt shows the total', lines.includes('Total $97.36'), lines);
    check('receipt comes from the box office', body.From.Address === 'boxoffice@halyardhall.example', body.From);
  }

  console.log('— boundary —');
  const cross = await fetch(`${base}/api/performances`, { headers: { origin: 'http://evil.example' } });
  check('cross origin is 403', cross.status === 403, await cross.text());
  const large = await fetch(`${base}/api/performances/${performanceId}/holds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seatIds: ['ST-A-1'], padding: 'x'.repeat(17000) }),
  });
  check('oversize body is 413', large.status === 413, await large.text());
  const wrongType = await fetch(`${base}/api/performances/${performanceId}/holds`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'hello',
  });
  check('wrong media type is 415', wrongType.status === 415, await wrongType.text());
  const badJson = await fetch(`${base}/api/performances/${performanceId}/holds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  check('bad json is 400', badJson.status === 400, await badJson.text());
  for (const path of ['/.env', '/run.json', '/package.json', '/.git/config', '/src/server/index.ts']) {
    const hidden = await fetch(`${base}${path}`);
    const text = await hidden.text();
    check(`${path} is not served`, hidden.status === 404 && !text.includes('DATABASE_URL'), hidden.status);
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void run();
