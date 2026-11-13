// Outage behaviour. Each service is made unreachable on its own instance by
// pointing that instance's configuration at a dead address.
import { chk, note, summary, get, post, sessionFor, runKey } from '../scripts/apitest.mjs';

const ines = await sessionFor('stw-ines');
const sanna = await sessionFor('br-sanna');
const rosa = await sessionFor('lp-rosa');
const petra = await sessionFor('tr-petra');
const kestrel = await sessionFor('lq-kestrel');

const mode = process.env['OUTAGE'] ?? '';
const STORE_DOWN =
  'The statement store is unreachable. Nothing was changed. Try again shortly.';

if (mode === 'storage') {
  note('while object storage is unreachable (DP-54)');
  const debtBefore = (await get('/api/positions/pos-0001', sanna)).body.debt;
  const draw = await post('/api/positions/pos-0001/draws', { amount: '1000000' }, sanna, {
    key: runKey('o1'),
  });
  chk('a draw is refused', draw.status, 503);
  chk(
    'the debt did not grow by the draw',
    BigInt((await get('/api/positions/pos-0001', sanna)).body.debt) - BigInt(debtBefore) <
      1000000n,
    true,
  );
  chk('statement_store_unavailable', draw.body.code, 'statement_store_unavailable');
  chk('with the storage outage copy', draw.body.detail, STORE_DOWN);

  const withdrawal = await post('/api/pools/QUSD/withdrawals', { amount: '1000000' }, rosa, {
    key: runKey('o2'),
  });
  chk('a liquidity withdrawal is refused', withdrawal.status, 503);
  chk('statement_store_unavailable', withdrawal.body.code, 'statement_store_unavailable');

  const price = await post('/api/prices', { asset: 'MBTC', price: '63000' }, ines);
  chk('a manual price post is refused', price.status, 503);
  chk('statement_store_unavailable', price.body.code, 'statement_store_unavailable');
  chk(
    'and the price did not change',
    (await get('/api/pools/MBTC', ines)).body.price,
    '64000.00000000',
  );
  chk(
    'no price post was recorded',
    (await get('/api/prices?asset=MBTC', ines)).body.prices.length,
    1,
  );

  note('nothing moved (DP-54)');
  // The seed itself drew on pos-0001, so the count is what matters.
  const drawCount = (await get('/api/ledger/postings?limit=200', ines)).body.postings.filter(
    (p) => p.kind === 'draw' && p.ref === 'pos-0001',
  ).length;
  chk('only the seed draw is on the books', drawCount, 1);
  chk(
    'the debt is unchanged',
    (await get('/api/positions/pos-0001', sanna)).body.debt >= '60000000000',
    true,
  );
  for (const t of (await get('/api/ledger/totals', ines)).body.assets)
    chk('net ' + t.asset, t.net, '0');

  note('a 5xx is not stored, so the same key runs fresh later (DP-16)');
  const again = await post('/api/positions/pos-0001/draws', { amount: '1000000' }, sanna, {
    key: runKey('o1'),
  });
  chk('the same key is refused again, not replayed', again.status, 503);
  chk('and is not marked as a replay', again.headers.get('idempotency-replayed'), null);

  note('every other action keeps working (DP-54)');
  chk(
    'a supply works',
    (await post('/api/pools/QUSD/supplies', { amount: '1000000' }, rosa)).status,
    201,
  );
  chk(
    'a repayment works',
    (await post('/api/positions/pos-0001/repayments', { amount: '1000000' }, sanna)).status,
    201,
  );
  chk(
    'adding collateral works',
    (
      await post(
        '/api/transfers',
        { actor_id: 'br-sanna', asset: 'MBTC', amount: '1000' },
        ines,
      )
    ).status,
    201,
  );
  chk(
    'a position opens',
    (
      await post(
        '/api/transfers',
        { actor_id: 'br-sanna', asset: 'METH', amount: '1000000000000000000' },
        ines,
      )
    ).status,
    201,
  );
  chk(
    'opening works',
    (
      await post(
        '/api/positions',
        {
          collateral_asset: 'METH',
          debt_asset: 'QUSD',
          collateral_amount: '1000000000000000000',
        },
        sanna,
      )
    ).status,
    201,
  );
  const quote = await post(
    '/api/swap/quotes',
    { from_asset: 'MBTC', to_asset: 'QUSD', amount_in: '1000000' },
    petra,
  );
  chk('a quote works', quote.status, 201);
  chk(
    'a swap works',
    (await post('/api/swaps', { quote_id: quote.body.quote_id }, petra, { key: runKey('o3') }))
      .status,
    201,
  );
  chk('reads keep working', (await get('/api/pools', ines)).status, 200);
  chk('the ledger keeps reading', (await get('/api/ledger/totals', ines)).status, 200);
}

if (mode === 'pdf') {
  note('while the PDF renderer is unreachable (DP-55, DP-57)');
  const draw = await post('/api/positions/pos-0001/draws', { amount: '1000000' }, sanna, {
    key: runKey('p1'),
  });
  chk('the draw commits', draw.status, 201);
  chk('the funds moved', draw.body.debt_after !== '0', true);
  chk('it reads pending', draw.body.statement_status, 'pending_statement');
  chk('no PDF instant yet', String(draw.body.pdf_rendered_at), 'null');
  await new Promise((r) => setTimeout(r, 6000));
  const later = await get(`/api/settlements/${draw.body.settlement_id}`, sanna);
  chk(
    'it stays pending while the renderer is down',
    later.body.statement_status,
    'pending_statement',
  );
  chk(
    'the funds are still moved',
    (await get('/api/positions/pos-0001', sanna)).body.debt !== '0',
    true,
  );
  chk(
    'the PDF download is refused',
    (await get(`/api/settlements/${draw.body.settlement_id}/statement.pdf`, sanna)).status,
    409,
  );
  chk(
    'pdf_pending',
    (await get(`/api/settlements/${draw.body.settlement_id}/statement.pdf`, sanna)).body.code,
    'pdf_pending',
  );
  chk(
    'pdf_pending detail',
    (await get(`/api/settlements/${draw.body.settlement_id}/statement.pdf`, sanna)).body.detail,
    'The PDF statement isn\u2019t ready yet.',
  );
  chk(
    'its webhook still goes out',
    await (async () => {
      for (let i = 0; i < 30; i += 1) {
        const row = await get(`/api/settlements/${draw.body.settlement_id}`, sanna);
        if (row.body.webhook_status === 'delivered') return true;
        await new Promise((r) => setTimeout(r, 400));
      }
      return false;
    })(),
    true,
  );
  process.stdout.write(`RENDER_PENDING=${draw.body.settlement_id}\n`);
}

if (mode === 'mail') {
  note('while mail is unreachable (DP-55, DP-57)');
  const warn = await post('/api/prices', { asset: 'MBTC', price: '57000' }, ines);
  chk('the price post works', warn.status, 201);
  const position = await get('/api/positions/pos-0002', ines);
  chk('the position is warned', position.body.state, 'warned');
  chk('a margin notice was queued', position.body.notices.length, 1);
  chk('it is not reported as sent', position.body.notices[0].status, 'queued');
  chk('with no sent instant', String(position.body.notices[0].sent_at), 'null');
  await new Promise((r) => setTimeout(r, 6000));
  const still = await get('/api/positions/pos-0002', ines);
  chk('it stays queued while mail is down', still.body.notices[0].status, 'queued');
  chk(
    'every action still completes',
    (await post('/api/positions/pos-0001/repayments', { amount: '1000000' }, sanna)).status,
    201,
  );
}

if (mode === 'svix') {
  note('while Svix is unreachable (DP-55)');
  const draw = await post('/api/positions/pos-0001/draws', { amount: '1000000' }, sanna, {
    key: runKey('v1'),
  });
  chk('the draw commits', draw.status, 201);
  chk('its event is queued', draw.body.webhook_status, 'queued');
  await new Promise((r) => setTimeout(r, 6000));
  const later = await get(`/api/settlements/${draw.body.settlement_id}`, sanna);
  chk('it stays queued', later.body.webhook_status, 'queued');
  chk('but the statement is still stored', later.body.statement_status, 'stored');
  chk('the funds moved', (await get('/api/positions/pos-0001', sanna)).body.debt !== '0', true);
}

summary();
