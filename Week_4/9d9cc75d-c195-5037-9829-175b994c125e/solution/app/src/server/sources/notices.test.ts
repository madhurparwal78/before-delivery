import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Relation } from '../../shared/model.ts';
import { STOCKISTS_CSV } from '../../shared/sample.ts';
import { readCsv } from './csv.ts';
import { joinNotices } from './notices.ts';

const relation: Relation = { left_table: 'left', left_key: 'Code', right_table: 'right', right_key: 'Code' };
const table = (name: string, text: string) => {
  const result = readCsv(Buffer.from(text), { csvMaxBytes: 20000000, rowMax: 50000 });
  assert.ok(result.ok);
  return { name, columns: result.table.columns, rows: result.table.rows };
};

test('no relation or no repeated key gives no notice', () => {
  const right = table('right', 'Code,V\nx,1\ny,2\n');
  assert.deepEqual(joinNotices({ relation: null, tables: [right] }), []);
  assert.deepEqual(joinNotices({ relation, tables: [right] }), []);
});

test('counts distinct repeated keys and names the first repeated one in file order', () => {
  const right = table('right', 'Code,V\nq,1\nr,2\nr,3\nq,4\nr,5\n,6\n,7\n');
  assert.deepEqual(joinNotices({ relation, tables: [right] }), ['right has 2 duplicate keys. First line kept: q.']);
});

test('the sample stockists with one repeated id', () => {
  const right = table('stockists', `${STOCKISTS_CSV}S2,Second Kettle,East,Gold,5\n`);
  const sample: Relation = { left_table: 'orders', left_key: 'Stockist ID', right_table: 'stockists', right_key: 'Stockist ID' };
  assert.deepEqual(joinNotices({ relation: sample, tables: [right] }), [
    'stockists has 1 duplicate keys. First line kept: S2.',
  ]);
});

test('number and date keys use the display rule', () => {
  const numbers = table('right', 'Code\n1500\n1500\n');
  assert.deepEqual(joinNotices({ relation, tables: [numbers] }), ['right has 1 duplicate keys. First line kept: 1,500.']);
  const dates = table('right', 'Code\n2027-01-04\n2027-01-04\n');
  assert.deepEqual(joinNotices({ relation, tables: [dates] }), [
    'right has 1 duplicate keys. First line kept: 2027-01-04.',
  ]);
});
