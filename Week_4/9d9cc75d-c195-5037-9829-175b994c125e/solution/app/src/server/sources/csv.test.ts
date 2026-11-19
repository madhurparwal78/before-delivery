import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORDERS_CSV, STOCKISTS_CSV } from '../../shared/sample.ts';
import { convertCell, inferType, parseCsv, parseDate, readCsv } from './csv.ts';

const limits = { csvMaxBytes: 20000000, rowMax: 50000 };
const read = (text: string, l = limits) => readCsv(Buffer.from(text), l);
const errorsOf = (text: string, l = limits) => {
  const result = read(text, l);
  assert.equal(result.ok, false);
  return result.ok ? [] : result.errors;
};

test('parseCsv handles quotes, doubled quotes, CRLF and a final line break', () => {
  const parsed = parseCsv('a,b\r\n"x, ""y""","two\nlines"\r\n,\n');
  assert.deepEqual(parsed.records, [
    { line: 1, fields: ['a', 'b'] },
    { line: 2, fields: ['x, "y"', 'two\nlines'] },
    { line: 4, fields: ['', ''] },
  ]);
  assert.equal(parsed.unterminatedLine, null);
});

test('parseCsv keeps a final record without a line break and a trailing comma', () => {
  assert.deepEqual(parseCsv('a,b\n1,').records, [
    { line: 1, fields: ['a', 'b'] },
    { line: 2, fields: ['1', ''] },
  ]);
});

test('parseCsv reports the line where an unterminated quote opened and stops', () => {
  const parsed = parseCsv('A\n1\n"x\ny\n');
  assert.equal(parsed.unterminatedLine, 3);
  assert.equal(parsed.records.length, 2);
});

test('type inference takes the first rule that holds', () => {
  assert.equal(inferType(['YES', 'no', 'True', 'false', 'NA']), 'boolean');
  assert.equal(inferType(['-3', '4.25', 'NULL', '10']), 'number');
  assert.equal(inferType(['2027-01-04', '2027-01-03T23:30:00-05:00', 'na']), 'date');
  assert.equal(inferType(['abc', '12', 'yes', '1.5e3']), 'text');
  assert.equal(inferType(['', 'NA', 'null']), 'text');
  assert.equal(inferType(['1', '2', '.5']), 'text');
  assert.equal(inferType(['2027-02-30']), 'text');
  assert.equal(inferType(['2027-01-03T23:30:00']), 'text');
});

test('dates are UTC epoch milliseconds, offsets converted first', () => {
  assert.equal(parseDate('2027-01-04'), Date.UTC(2027, 0, 4));
  assert.equal(parseDate('2027-01-03T23:30:00-05:00'), Date.UTC(2027, 0, 4, 4, 30));
  assert.equal(parseDate('2027-01-04T10:00:00.250Z'), Date.UTC(2027, 0, 4, 10, 0, 0, 250));
  assert.equal(convertCell('NA', 'number'), null);
  assert.equal(convertCell('Yes', 'boolean'), true);
  assert.equal(convertCell('no', 'boolean'), false);
});

test('the sample files read as the brief says', () => {
  const orders = read(ORDERS_CSV);
  assert.ok(orders.ok);
  if (!orders.ok) return;
  assert.deepEqual(
    orders.table.columns.map((c) => c.type),
    ['number', 'date', 'text', 'text', 'text', 'number', 'number'],
  );
  assert.equal(orders.table.rows.length, 16);
  assert.deepEqual(orders.table.rows[15]?.slice(5), [null, null]);
  const stockists = read(STOCKISTS_CSV);
  assert.ok(stockists.ok && stockists.table.rows.length === 5);
});

test('upload errors come in line order with the published messages', () => {
  assert.deepEqual(errorsOf(''), [{ line: null, message: 'File is empty.' }]);
  assert.deepEqual(errorsOf('A,B\n'), [{ line: null, message: 'File is empty.' }]);
  assert.deepEqual(errorsOf('A,A\n'), [{ line: null, message: 'File is empty.' }]);
  assert.deepEqual(errorsOf('A,,C\n1,2,3\n'), [{ line: 1, message: 'Line 1: column 2 has no name.' }]);
  assert.deepEqual(errorsOf('A,B,A,D\n1,"two\nlines",3,4\n1,2\n5,6,7,8\n"x,1,2,3\n'), [
    { line: 1, message: 'Line 1: duplicate column name "A".' },
    { line: 4, message: 'Line 4: expected 4 fields, found 2.' },
    { line: 6, message: 'Line 6: unterminated quote.' },
  ]);
});

test('size and row limits: the limit itself is allowed, one over is not', () => {
  const limit = { csvMaxBytes: 8, rowMax: 3 };
  assert.equal(read('A\n1\n2\n3\n', limit).ok, true);
  assert.deepEqual(errorsOf('A\n1\n2\n33\n', limit), [{ line: null, message: 'File is 9 bytes. The limit is 8.' }]);
  assert.deepEqual(errorsOf('A\n1\n2\n3\n4\n', { csvMaxBytes: 100, rowMax: 3 }), [
    { line: null, message: 'Table has 4 rows. The limit is 3.' },
  ]);
});

test('a byte order mark is not part of the first column name', () => {
  const result = read('﻿Name\nx\n');
  assert.ok(result.ok && result.table.columns[0]?.name === 'Name');
});
