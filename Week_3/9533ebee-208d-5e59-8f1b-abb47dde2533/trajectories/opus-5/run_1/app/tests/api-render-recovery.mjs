// Recovery after an outage: a settlement left Pending statement is rendered
// once by whichever process is running when the renderer answers again.
import { chk, note, summary, get, sessionFor } from '../scripts/apitest.mjs';

const settlementId = process.env['SETTLEMENT'];
const sanna = await sessionFor('br-sanna');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

note('the queued render is picked up once the renderer answers (DP-55, DP-57)');
const before = await get(`/api/settlements/${settlementId}`, sanna);
chk('it starts pending', before.body.statement_status, 'pending_statement');
chk('the funds had already moved', before.body.amount, '1000000');

let settled = before.body;
for (let i = 0; i < 60 && settled.statement_status !== 'stored'; i += 1) {
  await sleep(500);
  settled = (await get(`/api/settlements/${settlementId}`, sanna)).body;
}
chk(
  'it turns Settled with no further request from the borrower',
  settled.statement_status,
  'stored',
);
chk(
  'the PDF instant is set',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(settled.pdf_rendered_at),
  true,
);
chk(
  'the PDF downloads',
  (await get(`/api/settlements/${settlementId}/statement.pdf`, sanna)).status,
  200,
);

note('it is rendered exactly once (DP-56)');
const renderedAt = settled.pdf_rendered_at;
await sleep(4000);
const again = await get(`/api/settlements/${settlementId}`, sanna);
chk('the PDF instant never changes once set', again.body.pdf_rendered_at, renderedAt);

summary();
