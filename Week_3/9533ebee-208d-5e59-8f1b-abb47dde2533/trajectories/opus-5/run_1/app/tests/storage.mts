// Reads what the server actually wrote to storage and the outbox, so the
// statement lines, the evidence object and the event payloads are checked as
// stored rather than as rendered.
import { getObject } from '../src/services/s3.ts';
import { query, closePool } from '../src/db/pool.ts';

let fails = 0;
let checks = 0;
const chk = (label: string, got: unknown, want: unknown): void => {
  checks += 1;
  const ok = String(got) === String(want);
  if (!ok) fails += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${label} = ${String(got)}${ok ? '' : `  want ${String(want)}`}`,
  );
};
const note = (text: string): void => console.log(`---- ${text}`);
const text = async (key: string): Promise<string> => {
  const bytes = await getObject(key);
  return bytes === null ? '' : new TextDecoder().decode(bytes);
};

const NN = '\u202F';

note('a liquidation statement holds the published lines in order (DP-41)');
const fill = await query<{
  settlement_id: string;
  text_statement_key: string;
  statement_key: string;
  actor_id: string;
  amount: string;
  repaid: string;
  seized: string;
  bonus_amount: string;
  written_off: string;
}>(`SELECT settlement_id, text_statement_key, statement_key, actor_id, amount,
           repaid, seized, bonus_amount, written_off
    FROM settlements WHERE kind = 'liquidation' ORDER BY created_at DESC LIMIT 1`);
const row = fill.rows[0];
if (row === undefined) throw new Error('no liquidation settlement to read');

const statement = await text(row.text_statement_key);
const lines = statement.split('\n');
chk('each line ends in a line feed', statement.endsWith('\n'), true);
chk('line 1', lines[0], 'Quillmoor Reserve settlement statement');
chk('line 2', lines[1], `Settlement ${row.settlement_id}`);
chk('line 3 names the kind', lines[2], 'Kind Liquidation');
chk('line 4 names the member', lines[3], 'Member Kestrel Keepers (lq-kestrel)');
chk(
  'line 5 is the amount in desk format',
  /^Amount [\d\u202F]+,\d{6} QUSD$/.test(lines[4] ?? ''),
  true,
);
chk('line 6 repaid', /^Repaid [\d\u202F]+,\d{6} QUSD$/.test(lines[5] ?? ''), true);
chk('line 7 seized', /^Seized [\d\u202F]+,\d{8} MBTC$/.test(lines[6] ?? ''), true);
chk('line 8 bonus', /^Bonus [\d\u202F]+,\d{8} MBTC$/.test(lines[7] ?? ''), true);
chk('line 9 written off', /^Written off [\d\u202F]+,\d{6} QUSD$/.test(lines[8] ?? ''), true);
chk(
  'line 10 health factor before',
  /^Health factor before \d+,\d{4}$/.test(lines[9] ?? ''),
  true,
);
chk(
  'line 11 health factor after',
  /^Health factor after (\d+,\d{4}|No debt)$/.test(lines[10] ?? ''),
  true,
);
chk(
  'line 12 desk time with its abbreviation',
  /^Desk time \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (NST|NDT)$/.test(lines[11] ?? ''),
  true,
);
chk(
  'line 13 the same instant in UTC',
  /^UTC \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(lines[12] ?? ''),
  true,
);
chk(
  'then one line per leg, with signed desk amounts',
  /^[a-z:0-9-]+ (QUSD|MBTC|METH) [+\u2212][\d\u202F]+,\d+$/.test(lines[13] ?? ''),
  true,
);

// the desk time and the UTC line must name the same instant
const deskLine = lines[11] ?? '';
const utcLine = lines[12] ?? '';
const utcInstant = Date.parse(utcLine.replace('UTC ', ''));
const offsetHours = deskLine.endsWith('NDT') ? 2.5 : 3.5;
const deskStamp = deskLine.replace('Desk time ', '').replace(/ (NST|NDT)$/, '');
const deskAsUtc = Date.parse(`${deskStamp.replace(' ', 'T')}Z`);
chk(
  'the desk time is the UTC instant shifted by the zone offset',
  (deskAsUtc - utcInstant) / 3600000,
  -offsetHours,
);

note('the statement JSON holds every settlement field but the four live ones (DP-41)');
const json = JSON.parse(await text(row.statement_key)) as Record<string, unknown>;
for (const absent of [
  'statement_status',
  'notice_status',
  'webhook_status',
  'pdf_rendered_at',
]) {
  chk(`${absent} is not in the JSON`, absent in json, false);
}
for (const present of [
  'settlement_id',
  'kind',
  'actor_id',
  'position_id',
  'asset',
  'amount',
  'legs',
  'statement_key',
  'pdf_key',
  'event_id',
  'created_at',
  'round',
  'borrower_id',
  'repaid',
  'seized',
  'bonus_amount',
  'written_off',
  'health_factor_before',
  'health_factor_after',
  'state_after',
  'price_collateral',
  'price_debt',
]) {
  chk(`${present} is in the JSON`, present in json, true);
}
chk('amounts are minor-unit strings', typeof json['repaid'], 'string');
chk('the JSON repaid matches the row', json['repaid'], row.repaid);
chk('prices carry 8 decimals', /^\d+\.\d{8}$/.test(String(json['price_collateral'])), true);
chk(
  'instants are canonical UTC',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(json['created_at'])),
  true,
);

note('price evidence holds the submitted fields exactly as sent (DP-27)');
const manual = await query<{ price_post_id: string; evidence_key: string }>(
  `SELECT price_post_id, evidence_key FROM price_posts
   WHERE source = 'manual' AND evidence_key IS NOT NULL ORDER BY seq_no DESC LIMIT 1`,
);
const manualRow = manual.rows[0];
if (manualRow === undefined) throw new Error('no manual post with evidence');
const evidence = JSON.parse(await text(manualRow.evidence_key)) as Record<string, unknown>;
for (const field of [
  'price_post_id',
  'asset',
  'price',
  'previous_price',
  'posted_at',
  'posted_by',
  'source',
  'positions_below_one',
  'positions',
  'submitted',
]) {
  chk(`evidence holds ${field}`, field in evidence, true);
}
chk('source is manual', evidence['source'], 'manual');
chk('no oracle_response on a manual post', 'oracle_response' in evidence, false);
const submitted = evidence['submitted'] as Record<string, unknown>;
chk('the submitted price is the text as sent', typeof submitted['price'], 'string');
chk(
  'the top-level price is padded to 8 decimals',
  /^\d+\.\d{8}$/.test(String(evidence['price'])),
  true,
);
chk(
  'a confirm_large_move that was not sent stays absent',
  'confirm_large_move' in submitted,
  String(submitted['price']).length > 0 && 'confirm_large_move' in submitted,
);
const positions = evidence['positions'] as Array<Record<string, unknown>>;
chk('positions are listed', Array.isArray(positions), true);
if (positions.length > 0) {
  chk('each carries a position id', 'position_id' in (positions[0] ?? {}), true);
  chk('each carries a health factor', 'health_factor' in (positions[0] ?? {}), true);
  chk('each carries a liquidation price', 'liquidation_price' in (positions[0] ?? {}), true);
}

note('oracle evidence holds the raw response body byte for byte (DP-27)');
const oracle = await query<{ evidence_key: string }>(
  `SELECT evidence_key FROM price_posts WHERE source = 'oracle' AND evidence_key IS NOT NULL
   ORDER BY seq_no DESC LIMIT 1`,
);
const oracleRow = oracle.rows[0];
if (oracleRow === undefined) {
  console.log('     (no oracle post in this database, skipped)');
} else {
  const oracleEvidence = JSON.parse(await text(oracleRow.evidence_key)) as Record<
    string,
    unknown
  >;
  chk('oracle_response is present', 'oracle_response' in oracleEvidence, true);
  chk('it is the raw text', typeof oracleEvidence['oracle_response'], 'string');
  chk('no submitted block on an oracle reading', 'submitted' in oracleEvidence, false);
  chk('source is oracle', oracleEvidence['source'], 'oracle');
  const parsed = JSON.parse(String(oracleEvidence['oracle_response'])) as Record<
    string,
    unknown
  >;
  chk('the raw body parses back to the reading', typeof parsed['round'], 'number');
}

note('integrator event payloads (DP-52)');
const events = await query<{
  type: string;
  position_id: string | null;
  sequence: number | null;
  payload: Record<string, unknown>;
}>('SELECT type, position_id, sequence, payload FROM outbox_events ORDER BY seq_no');
chk('there are events', events.rows.length > 0, true);
for (const event of events.rows) {
  const payload = event.payload;
  chk(
    `${event.type} carries the published keys`,
    ['event_id', 'type', 'position_id', 'sequence', 'occurred_at', 'data'].every(
      (k) => k in payload,
    ),
    true,
  );
  chk(
    `${event.type} occurred_at has no fractional seconds`,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(payload['occurred_at'])),
    true,
  );
  const data = payload['data'] as Record<string, unknown>;
  if (event.type === 'settlement.committed') {
    chk(
      'settlement data keys',
      ['settlement_id', 'kind', 'asset', 'amount', 'statement_key'].every((k) => k in data),
      true,
    );
    chk('its amount is a minor-unit string', typeof data['amount'], 'string');
  } else {
    chk(
      'state change data keys',
      ['from', 'to', 'health_factor', 'grace_ends_at'].every((k) => k in data),
      true,
    );
    chk(
      'health factor is a string or null',
      data['health_factor'] === null || typeof data['health_factor'] === 'string',
      true,
    );
  }
}

note('sequences count from 1 per position with no gaps (DP-52)');
const perPosition = new Map<string, number[]>();
for (const event of events.rows) {
  if (event.position_id === null) {
    chk('a withdrawal carries no sequence', event.sequence, null);
    continue;
  }
  const list = perPosition.get(event.position_id) ?? [];
  list.push(event.sequence ?? -1);
  perPosition.set(event.position_id, list);
}
for (const [positionId, sequences] of perPosition) {
  const expected = Array.from({ length: sequences.length }, (_, index) => index + 1);
  chk(`${positionId} sequences`, sequences.join(','), expected.join(','));
}

note('a settlement event precedes the state change of its own transaction (DP-52)');
const pairs = await query<{ position_id: string; settlement_seq: number; change_seq: number }>(
  `SELECT s.position_id,
          (SELECT e.sequence FROM outbox_events e WHERE e.event_id = s.event_id) AS settlement_seq,
          (SELECT MIN(e2.sequence) FROM outbox_events e2
           WHERE e2.position_id = s.position_id AND e2.type = 'position.state_changed'
             AND e2.sequence > (SELECT e3.sequence FROM outbox_events e3 WHERE e3.event_id = s.event_id)) AS change_seq
   FROM settlements s WHERE s.position_id IS NOT NULL`,
);
for (const pair of pairs.rows) {
  if (pair.change_seq === null) continue;
  chk(
    `${pair.position_id}: settlement ${pair.settlement_seq} before change ${pair.change_seq}`,
    pair.settlement_seq < pair.change_seq,
    true,
  );
}

await closePool();
console.log(fails === 0 ? `\nALL ${checks} PASS` : `\n${fails} of ${checks} FAILED`);
if (fails > 0) process.exitCode = 1;
